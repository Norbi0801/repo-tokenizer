import { RepositorySpec } from '../ingest';
import { ChunkingOptions } from '../chunker';
import { SecretPattern } from '../normalization';
import type { GitProviderKind, GitHubProviderOptions, GitLabProviderOptions } from '../integrations/types';
import type { DomainConfig } from '../domain';

export type GitHubIntegrationConfig = GitHubProviderOptions;
export type GitLabIntegrationConfig = GitLabProviderOptions;

export interface ShardingConfig {
  chunksPerShard?: number;
  approxChunkSize?: number;
}

export interface PullRequestWorkflowConfig {
  defaultProvider?: GitProviderKind;
  autoComment?: boolean;
  autoStatusCheck?: boolean;
  statusContext?: string;
  statusTargetUrl?: string;
  failOnSecretFindings?: boolean;
  commentTemplate?: string;
}

export interface IntegrationsConfig {
  github?: GitHubIntegrationConfig;
  gitlab?: GitLabIntegrationConfig;
  pullRequests?: PullRequestWorkflowConfig;
}

export interface IndexingConfig {
  ref?: string;
  tokenizerId?: string;
  chunking?: Partial<ChunkingOptions>;
  includePaths?: string[];
  excludeGlobs?: string[];
  sparsePatterns?: string[];
  scanSecrets?: boolean;
  secretPatterns?: SecretPattern[];
  gitSubmodules?: boolean;
  gitLfs?: boolean;
  gitWorktree?: boolean;
  incremental?: boolean;
  baseRef?: string;
  concurrency?: number;
  maxInFlightBytes?: number;
  sharding?: ShardingConfig;
  maxFilesPerRun?: number;
  resumeCursor?: string;
  dryRun?: boolean;
  qualityReportPath?: string;
  qualityReportBase?: string;
  domain?: DomainConfig;
  languageChunkProfiles?: Record<string, Partial<ChunkingOptions>>;
}

export interface ExportConfig {
  format?: 'jsonl' | 'sqlite';
  output?: string;
  stream?: boolean;
}

export interface McpRoleTokenConfig {
  tokenEnv: string;
  roles?: string[];
  description?: string;
}

export interface ServerMcpConfig {
  enabled?: boolean;
  path?: string;
  allowAnonymous?: boolean;
  defaultRoles?: string[];
  tokens?: McpRoleTokenConfig[];
}

export interface ServerConfig {
  host?: string;
  port?: number;
  webhookUrl?: string;
  queueName?: string;
  airGap?: boolean;
  mcp?: ServerMcpConfig;
}

export interface RepoTokenizerConfig {
  repository: RepositorySpec;
  indexing?: IndexingConfig;
  export?: ExportConfig;
  server?: ServerConfig;
  integrations?: IntegrationsConfig;
  profiles?: Record<string, Partial<Omit<RepoTokenizerConfig, 'profiles'>>>;
}
