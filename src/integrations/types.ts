export type GitProviderKind = 'github' | 'gitlab';

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GitHubProviderOptions {
  owner: string;
  repo: string;
  token?: string;
  tokenEnv?: string;
  apiBaseUrl?: string;
}

export interface GitLabProviderOptions {
  projectId: string;
  token?: string;
  tokenEnv?: string;
  baseUrl?: string;
}

export type CommitStatusState = 'pending' | 'success' | 'failure' | 'error';

export interface CommitStatusPayload {
  state: CommitStatusState;
  description?: string;
  targetUrl?: string;
  context?: string;
}

export interface PullRequestFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  previousPath?: string;
}

export interface PullRequestDetails {
  id: number;
  number: number;
  title: string;
  url: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  files: PullRequestFile[];
}

export interface GitProvider {
  readonly kind: GitProviderKind;
  fetchPullRequest(id: number): Promise<PullRequestDetails>;
  createComment(id: number, body: string): Promise<void>;
  setCommitStatus(sha: string, payload: CommitStatusPayload): Promise<void>;
}
