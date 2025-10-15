import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import minimatch from 'minimatch';
import { openRepository, GitRepository, FilesystemRepository } from '../ingest';
import { Chunker, tokenizerRegistry, ChunkingOptions, Chunk } from '../chunker';
import {
  ContentFilterOptions,
  ContentNormalizer,
  ContentSanitizer,
  ContentDeduplicator,
  SanitizationRule,
  FileDetector,
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

export class IndexManager {
  private readonly indexes = new Map<string, IndexResult>();
  private readonly chunker = new Chunker();
  private readonly chunkCache = new Map<string, {
    path: string;
    chunks: IndexChunk[];
    file: IndexFileMetadata;
    content: string;
    language?: string;
  }>();

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

      for (const file of filesMeta) {
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

        files.push({
          path: file.path,
          size: detection.size,
          hash: fileHash,
          language,
          executable: file.executable,
        });
        fileLanguageByHash.set(fileHash, language);

        const chunkInput = {
          text: sanitized.sanitized,
          path: file.path,
          language,
        };

        fileContents.set(file.path, sanitized.sanitized);

        const fileChunks = this.chunker.generate(chunkInput, chunkingOptions).map((chunk) =>
          chunkToIndexChunk(chunk, fileHash),
        );

        for (const chunk of fileChunks) {
          const dedup = deduplicator.isDuplicate(chunk.text, chunk.id);
          if (dedup.duplicate) {
            continue;
          }
          chunks.push(chunk);
        }
      }

      const result: IndexResult = {
        spec,
        ref,
        files,
        chunks,
        createdAt: new Date().toISOString(),
        fileLanguageByHash: Object.fromEntries(fileLanguageByHash.entries()),
        fileContents: Object.fromEntries(fileContents.entries()),
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
}
