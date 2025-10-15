import { RepositorySpec } from '../ingest';
import { Chunk, ChunkingOptions } from '../chunker';
import { SecretFinding, SecretPattern } from '../normalization';

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
