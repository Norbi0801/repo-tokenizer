import { RepositorySpec } from '../ingest';
import { ChunkingOptions } from '../chunker';

export interface IndexingConfig {
  ref?: string;
  tokenizerId?: string;
  chunking?: Partial<ChunkingOptions>;
  includePaths?: string[];
  excludeGlobs?: string[];
  sparsePatterns?: string[];
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
}

export interface RepoTokenizerConfig {
  repository: RepositorySpec;
  indexing?: IndexingConfig;
  export?: ExportConfig;
  server?: ServerConfig;
  profiles?: Record<string, Partial<Omit<RepoTokenizerConfig, 'profiles'>>>;
}
