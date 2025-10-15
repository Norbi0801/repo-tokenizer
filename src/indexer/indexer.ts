import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { minimatch } from 'minimatch';
import { openRepository, GitRepository, FilesystemRepository } from '../ingest';
import { Chunker, tokenizerRegistry, ChunkingOptions, Chunk } from '../chunker';
import {
  ContentFilterOptions,
  ContentNormalizer,
  ContentSanitizer,
  ContentDeduplicator,
  SanitizationRule,
  FileDetector,
  SecretScanner,
  mergeSecretPatterns,
  SecretFinding,
} from '../normalization';
import { detectLanguageFromPath } from './language';
import {
  IndexResult,
  IndexOptions,
  IndexChunk,
  IndexFileMetadata,
  SearchResult,
  SymbolSearchResult,
} from './types';

const DEFAULT_SANITIZATION_RULES: SanitizationRule[] = [
  {
    id: 'env-secrets',
    description: 'Mask .env style secrets',
    pattern: /(API_KEY|SECRET|TOKEN|PASSWORD)=([^\n]+)/gi,
    replacement: '$1=***',
  },
];

const DEFAULT_CHUNKING: ChunkingOptions = {
  strategy: 'lines',
  tokenizer: tokenizerRegistry.resolve('basic'),
  targetLines: 200,
  overlap: 20,
  adaptive: {
    mergeSmallAdjacent: true,
    minChunkSizeLines: 20,
    splitLargeChunks: true,
    maxChunkSizeLines: 400,
  },
};

const DEFAULT_FILTER_OPTIONS: ContentFilterOptions = {
  binaryMimeSniff: true,
};

function makeIndexKey(spec: { type: string; path: string }, ref?: string) {
  return `${spec.type}:${spec.path}:${ref ?? 'HEAD'}`;
}

function chunkToIndexChunk(chunk: Chunk, fileHash: string): IndexChunk {
  return {
    ...chunk,
    fileHash,
  };
}

function cloneChunk(chunk: IndexChunk): IndexChunk {
  return {
    ...chunk,
    metadata: { ...chunk.metadata },
  };
}

export class IndexManager {
  private readonly indexes = new Map<string, IndexResult>();
  private readonly chunker = new Chunker();
  private readonly chunkCache = new Map<
    string,
    {
      path: string;
      chunks: IndexChunk[];
      file: IndexFileMetadata;
      content: string;
      language?: string;
      secrets: SecretFinding[];
    }
  >();

  async indexRepository(spec: IndexResult['spec'], options: IndexOptions = {}): Promise<IndexResult> {
    const repositoryHandle = await openRepository(spec);
    const cleanupCallbacks: Array<() => Promise<void>> = [];
    let basePath: string;
    let ref = options.ref;

    try {
      if (repositoryHandle.type === 'git') {
        const repo = repositoryHandle.repository as GitRepository;
        const snapshot = await repo.createSnapshot({ ref: options.ref, sparsePatterns: options.sparsePatterns });
        basePath = snapshot.path;
        ref = snapshot.commit;
        cleanupCallbacks.push(snapshot.cleanup.bind(snapshot));
        cleanupCallbacks.push(repo.cleanup.bind(repo));
      } else {
        const fsRepo = repositoryHandle.repository as FilesystemRepository;
        const snapshot = await fsRepo.createSnapshot();
        basePath = snapshot.path;
        cleanupCallbacks.push(snapshot.cleanup.bind(snapshot));
      }

      const repositoryImpl = repositoryHandle.repository as FilesystemRepository | GitRepository;

      const incremental = Boolean(options.incremental);
      let baseIndex: IndexResult | undefined;
      let baseCommit: string | undefined;
      let changedPathsSet: Set<string> | undefined;
      let deletedPathsSet: Set<string> | undefined;

      if (incremental) {
        if (repositoryHandle.type === 'git') {
          const repo = repositoryHandle.repository as GitRepository;
          if (options.baseRef) {
            baseCommit = await repo.resolveRef(options.baseRef).catch(() => undefined);
          }
          if (!baseCommit) {
            const previous = this.findLatestIndex(spec);
            if (previous?.ref) {
              baseCommit = previous.ref;
              baseIndex = previous;
            }
          }
          if (!baseIndex && baseCommit) {
            baseIndex = this.getIndex(spec, baseCommit);
          }
          if (!baseIndex) {
            baseIndex = this.findLatestIndex(spec);
            baseCommit = baseIndex?.ref;
          }
          if (baseIndex && baseCommit && ref) {
            const diff = await repo.listChangedFiles(baseCommit, ref);
            changedPathsSet = new Set(diff.changed);
            deletedPathsSet = new Set(diff.deleted);
          }
        } else {
          baseIndex = this.findLatestIndex(spec);
        }
      }

      const filesMeta = await repositoryImpl.listFiles({
        ref: options.ref,
        includePaths: options.includePaths,
        excludeGlobs: options.excludeGlobs,
        excludeRegexes: options.excludeRegexes,
        workspaceRoots: options.workspaceRoots,
        sparsePatterns: options.sparsePatterns,
      });

      const filterOptions: ContentFilterOptions = {
        ...DEFAULT_FILTER_OPTIONS,
      };
      const fileDetector = new FileDetector(filterOptions);
      const normalizer = new ContentNormalizer({
        removeBom: true,
        normalizeLineEndings: 'lf',
        trimTrailingWhitespace: true,
        collapseMultipleBlanks: true,
      });
      const sanitizer = new ContentSanitizer({ rules: DEFAULT_SANITIZATION_RULES });
      const deduplicator = new ContentDeduplicator();

      const tokenizer = options.chunking?.tokenizer ??
        (options.tokenizerId ? tokenizerRegistry.resolve(options.tokenizerId) : DEFAULT_CHUNKING.tokenizer);

      const chunkingOptions: ChunkingOptions = {
        ...DEFAULT_CHUNKING,
        ...options.chunking,
        tokenizer,
      };

      const files: IndexFileMetadata[] = [];
      const chunks: IndexChunk[] = [];
      const fileLanguageByHash = new Map<string, string | undefined>();
      const fileContents = new Map<string, string>();
      const secretFindings: SecretFinding[] = [];
      const scanSecrets = options.scanSecrets !== false;
      const secretScanner = scanSecrets ? new SecretScanner(mergeSecretPatterns(options.secretPatterns)) : undefined;

      if (baseIndex) {
        const baseChunksByPath = new Map<string, IndexChunk[]>();
        baseIndex.chunks.forEach((chunk) => {
          const bucket = baseChunksByPath.get(chunk.metadata.path) ?? [];
          bucket.push(cloneChunk(chunk));
          baseChunksByPath.set(chunk.metadata.path, bucket);
        });

        for (const file of baseIndex.files) {
          if (deletedPathsSet?.has(file.path)) {
            continue;
          }
          if (changedPathsSet?.has(file.path)) {
            continue;
          }
          files.push(file);
          fileLanguageByHash.set(file.hash, baseIndex.fileLanguageByHash[file.hash]);
          const existingContent = baseIndex.fileContents[file.path];
          if (existingContent !== undefined) {
            fileContents.set(file.path, existingContent);
          }
          const previousChunks = baseChunksByPath.get(file.path);
          if (previousChunks) {
            previousChunks.forEach((chunk) => chunks.push(cloneChunk(chunk)));
          }
        }

        secretFindings.push(
          ...baseIndex.secretFindings.filter((finding) => {
            if (deletedPathsSet?.has(finding.path)) {
              return false;
            }
            if (changedPathsSet?.has(finding.path)) {
              return false;
            }
            return true;
          }),
        );
      }

      for (const file of filesMeta) {
        if (changedPathsSet && !changedPathsSet.has(file.path)) {
          continue;
        }
        const absolutePath = join(basePath, file.path);
        const detection = await fileDetector.inspect(absolutePath);
        if (detection.isBinary || detection.isGenerated || detection.isLarge) {
          continue;
        }

        let raw: string;
        try {
          raw = await readFile(absolutePath, 'utf8');
        } catch (error) {
          // Skip files that cannot be read as text
          continue;
        }
        const normalized = normalizer.normalize(raw);
        const sanitized = sanitizer.sanitize(normalized.normalized);
        const fileHash = createHash('sha256').update(sanitized.sanitized).digest('hex');
        const language = detectLanguageFromPath(file.path);

        const cached = this.chunkCache.get(fileHash);
        if (cached && cached.path === file.path) {
          const clonedChunks = cached.chunks.map((chunk) => cloneChunk(chunk));
          chunks.push(...clonedChunks);
          files.push({
            path: file.path,
            size: detection.size,
            hash: fileHash,
            language,
            executable: file.executable,
            detectionReason: detection.reason,
          });
          fileLanguageByHash.set(fileHash, language);
          fileContents.set(file.path, cached.content);
          secretFindings.push(...cached.secrets);
          continue;
        }

        const chunkInput = {
          text: sanitized.sanitized,
          path: file.path,
          language,
        };

        fileContents.set(file.path, sanitized.sanitized);

        const secretsForFile = secretScanner ? secretScanner.scan(sanitized.sanitized, file.path) : [];
        secretFindings.push(...secretsForFile);

        const generatedChunks = this.chunker.generate(chunkInput, chunkingOptions).map((chunk) =>
          chunkToIndexChunk(chunk, fileHash),
        );

        const filteredChunks: IndexChunk[] = [];
        for (const chunk of generatedChunks) {
          const dedup = deduplicator.isDuplicate(chunk.text, chunk.id);
          if (dedup.duplicate) {
            continue;
          }
          filteredChunks.push(chunk);
          chunks.push(chunk);
        }

        const metadata: IndexFileMetadata = {
          path: file.path,
          size: detection.size,
          hash: fileHash,
          language,
          executable: file.executable,
          detectionReason: detection.reason,
        };
        files.push(metadata);
        fileLanguageByHash.set(fileHash, language);

        this.chunkCache.set(fileHash, {
          path: file.path,
          chunks: filteredChunks.map((chunk) => cloneChunk(chunk)),
          file: metadata,
          content: sanitized.sanitized,
          language,
          secrets: secretsForFile.map((finding) => ({ ...finding })),
        });
      }

      const result: IndexResult = {
        spec,
        ref,
        files,
        chunks,
        createdAt: new Date().toISOString(),
        fileLanguageByHash: Object.fromEntries(fileLanguageByHash.entries()),
        fileContents: Object.fromEntries(fileContents.entries()),
        secretFindings,
      };

      const key = makeIndexKey(spec, ref);
      this.indexes.set(key, result);
      return result;
    } finally {
      if (repositoryHandle.cleanup) {
        cleanupCallbacks.push(repositoryHandle.cleanup);
      }
      while (cleanupCallbacks.length > 0) {
        const cleanup = cleanupCallbacks.pop();
        if (cleanup) {
          await cleanup();
        }
      }
    }
  }

  getIndex(spec: IndexResult['spec'], ref?: string): IndexResult | undefined {
    const key = makeIndexKey(spec, ref);
    return this.indexes.get(key);
  }

  listFiles(spec: IndexResult['spec'], params: { ref?: string; include?: string[]; exclude?: string[] } = {}) {
    const index = this.getIndex(spec, params.ref);
    if (!index) {
      throw new Error('Index not found. Run indexRepository first.');
    }
    let files = index.files;
    if (params.include && params.include.length > 0) {
      files = files.filter((file) => params.include!.some((pattern) => minimatch(file.path, pattern)));
    }
    if (params.exclude && params.exclude.length > 0) {
      files = files.filter((file) => !params.exclude!.some((pattern) => minimatch(file.path, pattern)));
    }
    return files;
  }

  listChunks(spec: IndexResult['spec'], params: { ref?: string; path?: string; lang?: string; maxTokens?: number } = {}) {
    const index = this.getIndex(spec, params.ref);
    if (!index) {
      throw new Error('Index not found. Run indexRepository first.');
    }
    let chunks = index.chunks;
    if (params.path) {
      chunks = chunks.filter((chunk) => chunk.metadata.path === params.path);
    }
    if (params.lang) {
      chunks = chunks.filter((chunk) => {
        const lang = index.fileLanguageByHash[chunk.fileHash];
        return lang?.toLowerCase() === params.lang?.toLowerCase();
      });
    }
    if (params.maxTokens) {
      chunks = chunks.filter((chunk) => chunk.metadata.tokenCount <= params.maxTokens!);
    }
    return chunks;
  }

  getChunk(spec: IndexResult['spec'], id: string, ref?: string) {
    const index = this.getIndex(spec, ref);
    if (!index) {
      throw new Error('Index not found. Run indexRepository first.');
    }
    const chunk = index.chunks.find((entry) => entry.id === id);
    if (!chunk) {
      throw new Error(`Chunk ${id} not found`);
    }
    return chunk;
  }

  getFile(spec: IndexResult['spec'], path: string, ref?: string) {
    const index = this.getIndex(spec, ref);
    if (!index) {
      throw new Error('Index not found. Run indexRepository first.');
    }
    const file = index.files.find((entry) => entry.path === path);
    if (!file) {
      throw new Error(`File ${path} not found`);
    }
    return {
      ...file,
      content: index.fileContents[path],
      secrets: index.secretFindings.filter((finding) => finding.path === path),
    };
  }

  searchText(spec: IndexResult['spec'], query: string, params: { ref?: string; pathGlob?: string } = {}): SearchResult[] {
    const index = this.getIndex(spec, params.ref);
    if (!index) {
      throw new Error('Index not found. Run indexRepository first.');
    }
    const results: SearchResult[] = [];
    const matcher = params.pathGlob ? (path: string) => minimatch(path, params.pathGlob!) : () => true;

    for (const chunk of index.chunks) {
      const path = chunk.metadata.path;
      if (!matcher(path)) {
        continue;
      }
      const lines = chunk.text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          const absoluteLine = chunk.metadata.startLine + idx;
          const excerpt = line.trim().slice(0, 200);
          results.push({ path, line: absoluteLine, excerpt });
        }
      });
    }

    return results.slice(0, 2000);
  }

  searchSymbols(spec: IndexResult['spec'], query?: string, params: { ref?: string } = {}): SymbolSearchResult[] {
    const index = this.getIndex(spec, params.ref);
    if (!index) {
      throw new Error('Index not found. Run indexRepository first.');
    }
    const regexes = [
      /function\s+([A-Za-z0-9_]+)/,
      /class\s+([A-Za-z0-9_]+)/,
      /def\s+([A-Za-z0-9_]+)/,
      /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*\(/,
      /([A-Za-z0-9_]+)\s*:\s*function\s*\(/,
    ];
    const results: SymbolSearchResult[] = [];
    for (const chunk of index.chunks) {
      const lines = chunk.text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const regex of regexes) {
          const match = line.match(regex);
          if (!match) {
            continue;
          }
          const symbol = match[1] ?? match[2];
          if (!symbol) {
            continue;
          }
          if (query && !symbol.toLowerCase().includes(query.toLowerCase())) {
            continue;
          }
          results.push({
            symbol,
            path: chunk.metadata.path,
            line: chunk.metadata.startLine + idx,
            context: line.trim().slice(0, 200),
          });
        }
      });
    }
    return results.slice(0, 500);
  }

  private findLatestIndex(spec: IndexResult['spec']): IndexResult | undefined {
    const entries = Array.from(this.indexes.values());
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const candidate = entries[i];
      if (candidate.spec.type !== spec.type) {
        continue;
      }
      if (!candidate.spec.path || !spec.path) {
        continue;
      }
      if (candidate.spec.path !== spec.path) {
        continue;
      }
      if (spec.url && candidate.spec.url && spec.url !== candidate.spec.url) {
        continue;
      }
      return candidate;
    }
    return undefined;
  }
}
