import { RepositorySpec } from '../ingest';
import { Chunk, ChunkingOptions } from '../chunker';
import { SecretFinding, SecretPattern } from '../normalization';
import type { DomainConfig, DomainFinding } from '../domain';
import type {
  CommitStatusPayload,
  FetchLike,
  GitProvider,
  GitProviderKind,
  GitHubProviderOptions,
  GitLabProviderOptions,
  PullRequestDetails,
} from '../integrations/types';

export interface IndexShard {
  id: string;
  chunkIds: string[];
  chunkCount: number;
  size: number;
}

export interface ShardingOptions {
  chunksPerShard?: number;
  approxChunkSize?: number;
}

export interface IndexFileMetadata {
  path: string;
  size: number;
  hash: string;
  language?: string;
  executable: boolean;
  detectionReason?: string;
}

export interface IndexChunk extends Chunk {
  fileHash: string;
}

export interface IndexResult {
  spec: RepositorySpec;
  ref?: string;
  files: IndexFileMetadata[];
  chunks: IndexChunk[];
  createdAt: string;
  fileLanguageByHash: Record<string, string | undefined>;
  fileContents: Record<string, string>;
  secretFindings: SecretFinding[];
  shards?: IndexShard[];
  resumeCursor?: string;
  domainFindings?: DomainFinding[];
  testCoverage?: Record<string, string[]>;
  dependencyGraph?: Record<string, string[]>;
  symbolIndex?: Record<string, Array<{ path: string; line: number }>>;
}

export interface IndexOptions {
  ref?: string;
  includePaths?: string[];
  excludeGlobs?: string[];
  excludeRegexes?: RegExp[];
  workspaceRoots?: string[];
  sparsePatterns?: string[];
  chunking?: Partial<ChunkingOptions>;
  tokenizerId?: string;
  incremental?: boolean;
  baseRef?: string;
  scanSecrets?: boolean;
  secretPatterns?: SecretPattern[];
  gitSubmodules?: boolean;
  gitLfs?: boolean;
  gitWorktree?: boolean;
  concurrency?: number;
  maxInFlightBytes?: number;
  sharding?: ShardingOptions;
  maxFilesPerRun?: number;
  resumeCursor?: string;
  dryRun?: boolean;
  domain?: DomainConfig;
  languageChunkProfiles?: Record<string, Partial<ChunkingOptions>>;
}

export interface SearchResult {
  path: string;
  line: number;
  excerpt: string;
}

export interface SymbolSearchResult {
  symbol: string;
  path: string;
  line: number;
  context?: string;
}

export interface PullRequestIdentifier {
  provider: GitProviderKind;
  id: number;
}

export interface PullRequestProviderConfigs {
  github?: GitHubProviderOptions;
  gitlab?: GitLabProviderOptions;
}

export interface PullRequestCommentOptions {
  enabled?: boolean;
  template?: string;
}

export interface PullRequestStatusOptions {
  enabled?: boolean;
  context?: string;
  targetUrl?: string;
  failOnSecretFindings?: boolean;
}

export interface PullRequestIndexOptions {
  indexOptions?: IndexOptions;
  providers: PullRequestProviderConfigs;
  comment?: PullRequestCommentOptions;
  status?: PullRequestStatusOptions;
  fetch?: FetchLike;
  providerFactory?: (kind: GitProviderKind, fetch?: FetchLike) => GitProvider;
}

export interface PullRequestIndexResult {
  pullRequest: PullRequestDetails;
  index: IndexResult;
  commentSubmitted: boolean;
  statusSubmitted: boolean;
  statusPayload?: CommitStatusPayload;
}

export interface ChunkDiffEntry {
  chunk: IndexChunk;
  status: 'added' | 'removed';
}

export interface DiffChunksOptions {
  baseRef: string;
  headRef: string;
  paths?: string[];
  limit?: number;
  indexOptions?: IndexOptions;
}

export interface DiffChunksResult {
  added: IndexChunk[];
  removed: IndexChunk[];
  changedFiles: string[];
}

export interface BlameLine {
  line: number;
  commit: string;
  author: string;
  summary: string;
  timestamp: number;
}

export interface BlameResult {
  path: string;
  ref?: string;
  lines: BlameLine[];
}

export interface ContextPackOptions {
  ref?: string;
  paths?: string[];
  limit?: number;
  maxTokens?: number;
  indexOptions?: IndexOptions;
}

export interface ContextPackResult {
  chunks: IndexChunk[];
  totalChunks: number;
  totalTokens: number;
}
