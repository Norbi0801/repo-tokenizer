import { join, dirname, normalize } from 'node:path';
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
  PullRequestIdentifier,
  PullRequestIndexOptions,
  PullRequestIndexResult,
  IndexShard,
  ShardingOptions,
  DiffChunksOptions,
  DiffChunksResult,
  BlameResult,
  ContextPackOptions,
  ContextPackResult,
} from './types';
import { createGitProvider } from '../integrations';
import type { CommitStatusPayload, GitProvider, PullRequestDetails } from '../integrations';
import { DomainPolicyEngine, DomainFinding } from '../domain';

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

const DEFAULT_LANGUAGE_CHUNK_PROFILES: Record<string, Partial<ChunkingOptions>> = {
  typescript: {
    targetLines: 140,
    overlap: 20,
  },
  javascript: {
    targetLines: 140,
    overlap: 20,
  },
  python: {
    targetLines: 90,
    overlap: 15,
  },
  go: {
    targetLines: 120,
    overlap: 12,
  },
  markdown: {
    targetLines: 200,
    overlap: 5,
  },
};

const SYMBOL_REGEXES = [
  /function\s+([A-Za-z0-9_]+)/,
  /class\s+([A-Za-z0-9_]+)/,
  /def\s+([A-Za-z0-9_]+)/,
  /(const|let|var)\s+([A-Za-z0-9_]+)\s*=\s*\(/,
  /([A-Za-z0-9_]+)\s*:\s*function\s*\(/,
  /export\s+(?:const|let|var)\s+([A-Za-z0-9_]+)/,
];

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
      domainFindings: DomainFinding[];
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
        if (options.gitSubmodules !== false) {
          await repo.updateSubmodules().catch(() => undefined);
        }
        if (options.gitLfs !== false) {
          await repo.installLfs().catch(() => undefined);
        }
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
        if (!changedPathsSet && options.includePaths && options.includePaths.length > 0) {
          changedPathsSet = new Set(options.includePaths);
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
      const domainFindings: DomainFinding[] = [];
      const scanSecrets = options.scanSecrets !== false;
      const secretScanner = scanSecrets ? new SecretScanner(mergeSecretPatterns(options.secretPatterns)) : undefined;
      const domainEngine = options.domain ? new DomainPolicyEngine(options.domain) : undefined;
      const testCoverage = new Map<string, Set<string>>();
      const dependencyGraph = new Map<string, Set<string>>();

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
        if (baseIndex.domainFindings) {
          domainFindings.push(
            ...baseIndex.domainFindings.filter((finding) => {
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
        if (baseIndex.testCoverage) {
          Object.entries(baseIndex.testCoverage).forEach(([testPath, sources]) => {
            if (deletedPathsSet?.has(testPath)) {
              return;
            }
            if (changedPathsSet?.has(testPath)) {
              return;
            }
            testCoverage.set(testPath, new Set(sources));
          });
        }
        if (baseIndex.dependencyGraph) {
          Object.entries(baseIndex.dependencyGraph).forEach(([sourcePath, deps]) => {
            if (deletedPathsSet?.has(sourcePath)) {
              return;
            }
            const set = dependencyGraph.get(sourcePath) ?? new Set<string>();
            deps.forEach((dep) => {
              if (!deletedPathsSet?.has(dep)) {
                set.add(dep);
              }
            });
            dependencyGraph.set(sourcePath, set);
          });
        }
      }

      const concurrency = Math.max(1, options.concurrency ?? 4);
      const maxInFlightBytes = options.maxInFlightBytes && options.maxInFlightBytes > 0
        ? options.maxInFlightBytes
        : undefined;
      let inFlightBytes = 0;
      const waitQueue: Array<() => void> = [];

      const acquireBytes = async (size: number) => {
        if (!maxInFlightBytes || size <= 0) {
          return () => {};
        }
        while (inFlightBytes + size > maxInFlightBytes) {
          await new Promise<void>((resolve) => waitQueue.push(resolve));
        }
        inFlightBytes += size;
        return () => {
          inFlightBytes -= size;
          if (inFlightBytes < 0) {
            inFlightBytes = 0;
          }
          const next = waitQueue.shift();
          if (next) {
            next();
          }
        };
      };

      const candidateFiles = filesMeta.filter((file) => {
        if (changedPathsSet && !changedPathsSet.has(file.path)) {
          return false;
        }
        if (options.resumeCursor && file.path <= options.resumeCursor) {
          return false;
        }
        return true;
      });

      const maxFilesPerRun = options.maxFilesPerRun && options.maxFilesPerRun > 0 ? options.maxFilesPerRun : undefined;
      const totalWork = maxFilesPerRun ? Math.min(candidateFiles.length, maxFilesPerRun) : candidateFiles.length;
      const workerCount = totalWork === 0 ? 0 : Math.min(concurrency, totalWork);
      let cursor = 0;
      let processedCount = 0;
      let maxProcessedIndex = -1;

      const processFile = async (file: (typeof candidateFiles)[number]) => {
        const releaseBytes = await acquireBytes(file.size);
        try {
          const absolutePath = join(basePath, file.path);
          const detection = await fileDetector.inspect(absolutePath, file.path);
          if (detection.isBinary || detection.isGenerated || detection.isLarge) {
            return;
          }

          let raw: string;
          try {
            raw = await readFile(absolutePath, 'utf8');
          } catch (error) {
            return;
          }
          const normalized = normalizer.normalize(raw);
          const textForScan = normalized.normalized;
          const sanitized = sanitizer.sanitize(textForScan);
          let processedContent = sanitized.sanitized;
          const language = detectLanguageFromPath(file.path);
          const domainFindingsForFile: DomainFinding[] = [];

          if (domainEngine) {
            const evaluation = domainEngine.evaluate({ path: file.path, content: processedContent, language });
            domainFindingsForFile.push(...evaluation.findings);
            if (evaluation.action === 'deny') {
              domainFindings.push(...domainFindingsForFile);
              return;
            }
            processedContent = evaluation.content;
          }

          const fileHash = createHash('sha256').update(processedContent).digest('hex');

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
            domainFindings.push(...(cached.domainFindings ?? []));
            this.updateTestCoverage(testCoverage, file.path, cached.content);
            this.updateDependencyGraph(dependencyGraph, file.path, cached.content);
            return;
          }

          const chunkInput = {
            text: processedContent,
            path: file.path,
            language,
          };

          fileContents.set(file.path, processedContent);
          files.push({
            path: file.path,
            size: detection.size,
            hash: fileHash,
            language,
            executable: file.executable,
            detectionReason: detection.reason,
          });
          fileLanguageByHash.set(fileHash, language);

          const secretsForFile = secretScanner ? secretScanner.scan(textForScan, file.path) : [];
          secretFindings.push(...secretsForFile);
          domainFindings.push(...domainFindingsForFile);
          this.updateTestCoverage(testCoverage, file.path, processedContent);
          this.updateDependencyGraph(dependencyGraph, file.path, processedContent);

          const profileMap = options.languageChunkProfiles ?? DEFAULT_LANGUAGE_CHUNK_PROFILES;
          const languageProfile = language ? profileMap[language.toLowerCase()] : undefined;
          const effectiveChunking = languageProfile
            ? {
                ...chunkingOptions,
                ...languageProfile,
                tokenizer: languageProfile.tokenizer ?? chunkingOptions.tokenizer,
              }
            : chunkingOptions;

          const generatedChunks = this.chunker.generate(chunkInput, effectiveChunking).map((chunk) =>
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

        if (!options.dryRun) {
          this.chunkCache.set(fileHash, {
            path: file.path,
            chunks: filteredChunks.map((chunk) => cloneChunk(chunk)),
            file: {
              path: file.path,
              size: detection.size,
              hash: fileHash,
              language,
              executable: file.executable,
              detectionReason: detection.reason,
            },
            content: processedContent,
            language,
            secrets: secretsForFile.map((finding) => ({ ...finding })),
            domainFindings: domainFindingsForFile.map((finding) => ({ ...finding })),
          });
        }
        } finally {
          releaseBytes();
        }
      };

      if (workerCount > 0) {
        const workers = Array.from({ length: workerCount }, async () => {
          while (true) {
            if (maxFilesPerRun && processedCount >= maxFilesPerRun) {
              break;
            }
            const index = cursor;
            if (index >= candidateFiles.length) {
              break;
            }
            cursor += 1;
            processedCount += 1;
            const file = candidateFiles[index];
            await processFile(file);
            if (index > maxProcessedIndex) {
              maxProcessedIndex = index;
            }
          }
        });
        await Promise.all(workers);
      }

      if (files.length > 1) {
        files.sort((a, b) => a.path.localeCompare(b.path));
      }
      if (chunks.length > 1) {
        chunks.sort((a, b) => {
          const pathCompare = a.metadata.path.localeCompare(b.metadata.path);
          if (pathCompare !== 0) {
            return pathCompare;
          }
          return a.metadata.startLine - b.metadata.startLine;
        });
      }
      if (secretFindings.length > 1) {
        secretFindings.sort((a, b) => {
          const pathCompare = a.path.localeCompare(b.path);
          if (pathCompare !== 0) {
            return pathCompare;
          }
          return a.line - b.line;
        });
      }

      if (domainFindings.length > 1) {
        domainFindings.sort((a, b) => {
          const pathCompare = a.path.localeCompare(b.path);
          if (pathCompare !== 0) {
            return pathCompare;
          }
          return a.message.localeCompare(b.message);
        });
      }

      const shards = this.buildShards(chunks, options.sharding);
      const hasMoreFiles = maxProcessedIndex >= 0 && maxProcessedIndex + 1 < candidateFiles.length;
      const resumeCursorResult = hasMoreFiles ? candidateFiles[maxProcessedIndex].path : undefined;

      const testCoverageRecord = this.mapSetRecord(testCoverage);
      const dependencyGraphRecord = this.mapSetRecord(dependencyGraph);
      const symbolIndex = this.buildSymbolIndex(chunks);

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
      if (shards && shards.length > 0) {
        result.shards = shards;
      }
      if (resumeCursorResult) {
        result.resumeCursor = resumeCursorResult;
      }
      if (domainFindings.length > 0) {
        result.domainFindings = domainFindings;
      }
      if (Object.keys(testCoverageRecord).length > 0) {
        result.testCoverage = testCoverageRecord;
      }
      if (Object.keys(dependencyGraphRecord).length > 0) {
        result.dependencyGraph = dependencyGraphRecord;
      }
      if (Object.keys(symbolIndex).length > 0) {
        result.symbolIndex = symbolIndex;
      }

      if (!options.dryRun) {
        const key = makeIndexKey(spec, ref);
        this.indexes.set(key, result);
      }
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
    const results: SymbolSearchResult[] = [];
    for (const chunk of index.chunks) {
      const lines = chunk.text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        for (const regex of SYMBOL_REGEXES) {
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

  async indexPullRequest(
    spec: IndexResult['spec'],
    request: PullRequestIdentifier,
    options: PullRequestIndexOptions,
  ): Promise<PullRequestIndexResult> {
    if (!options || !options.providers) {
      throw new Error('Pull request indexing requires provider configurations');
    }

    const factory =
      options.providerFactory ?? ((kind, fetchImpl) => createGitProvider(kind, options.providers, fetchImpl));
    const provider = factory(request.provider, options.fetch);
    const pullRequest = await provider.fetchPullRequest(request.id);

    const statusOptions = options.status ?? {};
    const commentOptions = options.comment ?? {};
    const statusEnabled = statusOptions.enabled === true;
    const commentEnabled = commentOptions.enabled === true;
    const context = statusOptions.context ?? 'repo-tokenizer/index';

    let statusPayload: CommitStatusPayload | undefined;
    let statusSubmitted = false;
    if (statusEnabled) {
      const pendingPayload = this.makeStatusPayload('pending', context, 'Repo Tokenizer indexing in progress', statusOptions.targetUrl);
      statusSubmitted = (await this.safeSetStatus(provider, pullRequest.headSha, pendingPayload)) || statusSubmitted;
    }

    const includePaths = this.deriveIncludePaths(options.indexOptions?.includePaths, pullRequest.files);
    const baseIndexOptions: IndexOptions = {
      ...options.indexOptions,
      ref: pullRequest.headSha,
      includePaths,
    };

    let indexResult: IndexResult;
    try {
      indexResult = await this.indexRepository(spec, baseIndexOptions);
    } catch (error) {
      if (statusEnabled) {
        const errorPayload = this.makeStatusPayload(
          'error',
          context,
          `Indexing failed: ${(error as Error).message.slice(0, 110)}`,
          statusOptions.targetUrl,
        );
        await this.safeSetStatus(provider, pullRequest.headSha, errorPayload);
      }
      throw error;
    }

    const hasSecrets = indexResult.secretFindings.length > 0;
    if (statusEnabled) {
      const shouldFail = Boolean(statusOptions.failOnSecretFindings) && hasSecrets;
      const description = this.buildStatusDescription(indexResult, shouldFail, hasSecrets);
      statusPayload = this.makeStatusPayload(
        shouldFail ? 'failure' : 'success',
        context,
        description,
        statusOptions.targetUrl,
      );
      statusSubmitted = (await this.safeSetStatus(provider, pullRequest.headSha, statusPayload)) || statusSubmitted;
    }

    let commentSubmitted = false;
    if (commentEnabled) {
      const commentBody = this.renderComment(commentOptions.template, pullRequest, indexResult);
      commentSubmitted = await this.safeCreateComment(provider, pullRequest.number, commentBody);
    }

    return {
      pullRequest,
      index: indexResult,
      commentSubmitted,
      statusSubmitted,
      statusPayload,
    };
  }

  private deriveIncludePaths(existing: string[] | undefined, files: PullRequestDetails['files']): string[] | undefined {
    const changed = files.filter((file) => file.status !== 'removed').map((file) => file.path);
    if (changed.length === 0) {
      return existing && existing.length > 0 ? Array.from(new Set(existing)) : undefined;
    }
    if (!existing || existing.length === 0) {
      return Array.from(new Set(changed));
    }
    const changedSet = new Set(changed);
    const intersection = existing.filter((path) => changedSet.has(path));
    return intersection.length > 0 ? Array.from(new Set(intersection)) : Array.from(new Set(changed));
  }

  private buildStatusDescription(index: IndexResult, failed: boolean, hasSecrets: boolean): string {
    const parts = [`files:${index.files.length}`, `chunks:${index.chunks.length}`];
    if (hasSecrets) {
      parts.push(`secrets:${index.secretFindings.length}`);
    }
    if (failed) {
      parts.push('status:attention');
    }
    return `Repo Tokenizer ${parts.join(' • ')}`;
  }

  private makeStatusPayload(
    state: CommitStatusPayload['state'],
    context: string,
    description: string,
    targetUrl?: string,
  ): CommitStatusPayload {
    return {
      state,
      context,
      description,
      targetUrl,
    };
  }

  private async safeSetStatus(provider: GitProvider, sha: string, payload: CommitStatusPayload): Promise<boolean> {
    try {
      await provider.setCommitStatus(sha, payload);
      return true;
    } catch (error) {
      console.warn(`Failed to set commit status: ${(error as Error).message}`);
      return false;
    }
  }

  private async safeCreateComment(provider: GitProvider, id: number, body: string): Promise<boolean> {
    try {
      await provider.createComment(id, body);
      return true;
    } catch (error) {
      console.warn(`Failed to post pull request comment: ${(error as Error).message}`);
      return false;
    }
  }

  private renderComment(template: string | undefined, pullRequest: PullRequestDetails, index: IndexResult): string {
    const defaultTemplate = [
      '### Repo Tokenizer Summary',
      '',
      `- Files processed: {{files}}`,
      `- Chunks generated: {{chunks}}`,
      `- Secrets detected: {{secrets}}`,
      '',
      'Changed files:',
      '{{changedFiles}}',
      '',
      `Head: {{headRef}} ({{headSha}})`,
      `Base: {{baseRef}} ({{baseSha}})`,
      '',
      'Powered by repo-tokenizer.',
    ].join('\n');

    const context = {
      files: String(index.files.length),
      chunks: String(index.chunks.length),
      secrets: String(index.secretFindings.length),
      headRef: pullRequest.headRef,
      headSha: pullRequest.headSha.slice(0, 12),
      baseRef: pullRequest.baseRef,
      baseSha: pullRequest.baseSha.slice(0, 12),
      url: pullRequest.url,
      changedFiles: pullRequest.files
        .slice(0, 20)
        .map((file) => `- ${file.status.toUpperCase()} ${file.path}`)
        .join('\n') || '- (no tracked file changes)',
    };

    return this.formatTemplate(template ?? defaultTemplate, context);
  }

  private formatTemplate(template: string, context: Record<string, string>): string {
    return template.replace(/{{(.*?)}}/g, (_, rawKey: string) => {
      const key = rawKey.trim();
      return context[key] ?? '';
    });
  }

  private buildShards(chunks: IndexChunk[], sharding?: ShardingOptions): IndexShard[] | undefined {
    if (!sharding) {
      return undefined;
    }
    const maxChunks = sharding.chunksPerShard ?? 0;
    const maxSize = sharding.approxChunkSize ?? 0;
    if (!maxChunks && !maxSize) {
      return undefined;
    }
    const shards: IndexShard[] = [];
    let current: IndexShard = { id: 'shard-1', chunkIds: [], chunkCount: 0, size: 0 };
    for (const chunk of chunks) {
      const chunkSize = chunk.text.length;
      const exceedsChunkLimit = maxChunks > 0 && current.chunkCount >= maxChunks;
      const exceedsSizeLimit = maxSize > 0 && current.size + chunkSize > maxSize;
      if (current.chunkCount > 0 && (exceedsChunkLimit || exceedsSizeLimit)) {
        shards.push({ ...current });
        current = { id: `shard-${shards.length + 1}`, chunkIds: [], chunkCount: 0, size: 0 };
      }
      current.chunkIds.push(chunk.id);
      current.chunkCount += 1;
      current.size += chunkSize;
    }
    if (current.chunkCount > 0) {
      shards.push({ ...current });
    }
    return shards;
  }

  private mapSetRecord(map: Map<string, Set<string>>): Record<string, string[]> {
    const record: Record<string, string[]> = {};
    map.forEach((set, key) => {
      if (set.size === 0) {
        return;
      }
      record[key] = Array.from(set).sort();
    });
    return record;
  }

  private updateTestCoverage(map: Map<string, Set<string>>, filePath: string, content: string): void {
    if (!this.isTestFile(filePath)) {
      return;
    }
    const candidates = this.inferSourceCandidates(filePath, content);
    if (candidates.length === 0) {
      return;
    }
    const normalizedPath = filePath.replace(/\\/g, '/');
    const set = map.get(normalizedPath) ?? new Set<string>();
    candidates.forEach((candidate) => set.add(candidate));
    map.set(normalizedPath, set);
  }

  private isTestFile(filePath: string): boolean {
    const normalizedPath = filePath.replace(/\\/g, '/');
    return /(__tests__|\.test\.|\.spec\.|\/tests\/)/i.test(normalizedPath);
  }

  private inferSourceCandidates(filePath: string, _content: string): string[] {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const candidates = new Set<string>();
    if (normalizedPath.includes('__tests__/')) {
      candidates.add(normalizedPath.replace('__tests__/', '').replace(/\.test(\.[^.]+)$/, '$1').replace(/\.spec(\.[^.]+)$/, '$1'));
    }
    if (normalizedPath.includes('/tests/')) {
      candidates.add(normalizedPath.replace('/tests/', '/').replace(/\.test(\.[^.]+)$/, '$1'));
    }
    candidates.add(normalizedPath.replace(/\.test(\.[^.]+)$/, '$1'));
    candidates.add(normalizedPath.replace(/\.spec(\.[^.]+)$/, '$1'));
    return Array.from(candidates)
      .map((candidate) => candidate.replace(/\/+/g, '/'))
      .filter((candidate) => candidate !== normalizedPath);
  }

  private updateDependencyGraph(map: Map<string, Set<string>>, filePath: string, content: string): void {
    const imports = this.extractImports(filePath, content);
    if (imports.length === 0) {
      return;
    }
    const normalizedPath = filePath.replace(/\\/g, '/');
    const set = map.get(normalizedPath) ?? new Set<string>();
    imports.forEach((dependency) => set.add(dependency));
    map.set(normalizedPath, set);
  }

  private extractImports(filePath: string, content: string): string[] {
    const matches: string[] = [];
    const importRegex = /import\s+[^'";]*['"]([^'";]+)['"]/g;
    const dynamicImportRegex = /import\(['"]([^'";]+)['"]\)/g;
    const requireRegex = /require\(['"]([^'";]+)['"]\)/g;
    const baseDir = dirname(filePath);

    const collect = (regex: RegExp) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content))) {
        const specifier = match[1];
        const resolved = this.resolveImportPath(baseDir, specifier);
        if (resolved) {
          matches.push(resolved);
        }
      }
    };

    collect(importRegex);
    collect(dynamicImportRegex);
    collect(requireRegex);
    return Array.from(new Set(matches));
  }

  private resolveImportPath(baseDir: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) {
      return undefined;
    }
    const resolved = normalize(join(baseDir, specifier)).replace(/\\/g, '/');
    return resolved;
  }

  private buildSymbolIndex(chunks: IndexChunk[]): Record<string, Array<{ path: string; line: number }>> {
    const map = new Map<string, Array<{ path: string; line: number }>>();
    chunks.forEach((chunk) => {
      const lines = chunk.text.split(/\r?\n/);
      lines.forEach((line, idx) => {
        SYMBOL_REGEXES.forEach((regex) => {
          const match = line.match(regex);
          const symbol = match?.[1] ?? match?.[2];
          if (!symbol) {
            return;
          }
          const list = map.get(symbol) ?? [];
          list.push({ path: chunk.metadata.path, line: chunk.metadata.startLine + idx });
          map.set(symbol, list);
        });
      });
    });
    const record: Record<string, Array<{ path: string; line: number }>> = {};
    map.forEach((entries, symbol) => {
      record[symbol] = entries;
    });
    return record;
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

  async diffChunks(spec: IndexResult['spec'], options: DiffChunksOptions): Promise<DiffChunksResult> {
    const includePaths = options.paths && options.paths.length > 0 ? options.paths : options.indexOptions?.includePaths;
    const baseIndex = await this.indexRepository(spec, {
      ...options.indexOptions,
      ref: options.baseRef,
      includePaths,
      dryRun: true,
    });
    const headIndex = await this.indexRepository(spec, {
      ...options.indexOptions,
      ref: options.headRef,
      includePaths,
      dryRun: true,
    });

    const limit = options.limit ?? 200;
    const filterPaths = new Set(options.paths ?? []);

    const baseChunks = new Map<string, IndexChunk>();
    baseIndex.chunks.forEach((chunk) => {
      if (filterPaths.size > 0 && !filterPaths.has(chunk.metadata.path)) {
        return;
      }
      baseChunks.set(chunk.id, chunk);
    });

    const headChunks = new Map<string, IndexChunk>();
    headIndex.chunks.forEach((chunk) => {
      if (filterPaths.size > 0 && !filterPaths.has(chunk.metadata.path)) {
        return;
      }
      headChunks.set(chunk.id, chunk);
    });

    const added: IndexChunk[] = [];
    const removed: IndexChunk[] = [];

    headChunks.forEach((chunk, id) => {
      if (!baseChunks.has(id) && added.length < limit) {
        added.push(chunk);
      }
    });

    baseChunks.forEach((chunk, id) => {
      if (!headChunks.has(id) && removed.length < limit) {
        removed.push(chunk);
      }
    });

    const changedFiles: string[] = [];
    const baseFiles = new Map(baseIndex.files.map((file) => [file.path, file]));
    headIndex.files.forEach((file) => {
      const previous = baseFiles.get(file.path);
      if (!previous) {
        return;
      }
      if (previous.hash !== file.hash) {
        changedFiles.push(file.path);
      }
    });

    return {
      added,
      removed,
      changedFiles,
    };
  }

  async blameFile(spec: IndexResult['spec'], params: { path: string; ref?: string }): Promise<BlameResult> {
    const handle = await openRepository(spec);
    const cleanup = handle.cleanup;
    try {
      if (handle.type !== 'git') {
        throw new Error('Blame is only supported for Git repositories.');
      }
      const repo = handle.repository as GitRepository;
      const lines = await repo.blame(params.path, params.ref);
      return { path: params.path, ref: params.ref, lines };
    } finally {
      if (cleanup) {
        await cleanup();
      }
    }
  }

  async resolveReference(spec: IndexResult['spec'], ref: string): Promise<string> {
    const handle = await openRepository(spec);
    const cleanup = handle.cleanup;
    try {
      if (handle.type !== 'git') {
        throw new Error('resolveReference is only supported for Git repositories');
      }
      const repo = handle.repository as GitRepository;
      return await repo.resolveRef(ref);
    } finally {
      if (cleanup) {
        await cleanup();
      }
    }
  }

  async buildContextPack(spec: IndexResult['spec'], options: ContextPackOptions = {}): Promise<ContextPackResult> {
    const limit = options.limit ?? 20;
    const maxTokens = options.maxTokens ?? Infinity;
    const includePaths = options.paths && options.paths.length > 0 ? options.paths : options.indexOptions?.includePaths;
    const index = this.getIndex(spec, options.ref) ?? await this.indexRepository(spec, {
      ...options.indexOptions,
      ref: options.ref,
      includePaths,
      dryRun: true,
    });

    const pathFilter = options.paths && options.paths.length > 0 ? new Set(options.paths) : undefined;
    const filtered = index.chunks.filter((chunk) => {
      if (pathFilter && !pathFilter.has(chunk.metadata.path)) {
        return false;
      }
      return (chunk.metadata.tokenCount ?? chunk.text.length) <= maxTokens;
    });

    const sorted = filtered.sort((a, b) => {
      const tokenA = a.metadata.tokenCount ?? a.text.length;
      const tokenB = b.metadata.tokenCount ?? b.text.length;
      return tokenB - tokenA;
    });

    const selected = sorted.slice(0, limit);
    const totalChunks = selected.length;
    const totalTokens = selected.reduce(
      (sum, chunk) => sum + (chunk.metadata.tokenCount ?? chunk.text.length),
      0,
    );

    return {
      chunks: selected,
      totalChunks,
      totalTokens,
    };
  }
}
