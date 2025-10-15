import { RepositorySpec } from '../ingest';
import { ChunkingOptions } from '../chunker';
import { SecretPattern } from '../normalization';

export interface IndexingConfig {
  ref?: string;
  tokenizerId?: string;
  chunking?: Partial<ChunkingOptions>;
  includePaths?: string[];
  excludeGlobs?: string[];
  sparsePatterns?: string[];
  scanSecrets?: boolean;
  secretPatterns?: SecretPattern[];
}

export interface ExportConfig {
  format?: 'jsonl' | 'sqlite';
  output?: string;
  stream?: boolean;
}

export interface ServerConfig {
  host?: string;
  port?: number;
  webhookUrl?: string;
  queueName?: string;
  airGap?: boolean;
}

export interface RepoTokenizerConfig {
  repository: RepositorySpec;
  indexing?: IndexingConfig;
  export?: ExportConfig;
  server?: ServerConfig;
  profiles?: Record<string, Partial<Omit<RepoTokenizerConfig, 'profiles'>>>;
}
