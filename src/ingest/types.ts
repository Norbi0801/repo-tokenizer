export type GitRefType = 'branch' | 'tag' | 'remote' | 'commit';

export interface GitReference {
  name: string;
  fullName: string;
  type: GitRefType;
  commit: string;
  isDefault?: boolean;
}

export interface Snapshot {
  path: string;
  commit?: string;
  cleanup(): Promise<void>;
}

export interface ListFilesOptions {
  ref?: string;
  includePaths?: string[];
  excludeGlobs?: string[];
  excludeRegexes?: RegExp[];
  includeUntracked?: boolean;
  workspaceRoots?: string[];
  sparsePatterns?: string[];
}

export interface DiffResult {
  changed: string[];
  deleted: string[];
}

export interface FileEntry {
  path: string;
  size: number;
  executable: boolean;
  objectId?: string;
}

export interface WorkspaceInfo {
  type: 'npm' | 'yarn' | 'npm' | 'go' | 'cargo' | 'bazel' | 'lerna' | 'rush' | 'other';
  manifest: string;
  root: string;
  packages?: string[];
}

export interface RepositorySpec {
  type: 'git' | 'filesystem' | 'archive';
  path: string;
  url?: string;
  archiveType?: 'tar' | 'zip';
}
