import {
  type CommitStatusPayload,
  type FetchLike,
  type GitLabProviderOptions,
  type GitProvider,
  type PullRequestDetails,
  type PullRequestFile,
} from './types';

interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  sha: string;
  target_branch: string;
  source_branch: string;
  diff_refs?: {
    base_sha: string;
    head_sha: string;
  };
}

interface GitLabChangeResponse {
  changes: Array<{
    new_path: string;
    old_path: string;
    new_file: boolean;
    renamed_file: boolean;
    deleted_file: boolean;
  }>;
}

export class GitLabProvider implements GitProvider {
  readonly kind = 'gitlab';

  private readonly project: string;
  private readonly token?: string;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GitLabProviderOptions, fetchImpl: FetchLike) {
    if (!options.projectId) {
      throw new Error('GitLab provider requires "projectId" option');
    }

    this.project = encodeURIComponent(options.projectId);
    this.token = options.token ?? (options.tokenEnv ? process.env[options.tokenEnv] : undefined);
    this.apiBase = options.baseUrl ? options.baseUrl.replace(/\/+$/, '') : 'https://gitlab.com/api/v4';
    this.fetchImpl = fetchImpl;
  }

  async fetchPullRequest(id: number): Promise<PullRequestDetails> {
    const mr = await this.requestJson<GitLabMergeRequest>(`/projects/${this.project}/merge_requests/${id}`);
    const changes = await this.requestJson<GitLabChangeResponse>(
      `/projects/${this.project}/merge_requests/${id}/changes`,
    );

    const baseSha = mr.diff_refs?.base_sha ?? mr.sha;
    const headSha = mr.diff_refs?.head_sha ?? mr.sha;

    const files: PullRequestFile[] = changes.changes.map((file) => {
      if (file.deleted_file) {
        return {
          path: file.old_path,
          status: 'removed',
        };
      }
      if (file.renamed_file) {
        return {
          path: file.new_path,
          previousPath: file.old_path,
          status: 'renamed',
        };
      }
      if (file.new_file) {
        return {
          path: file.new_path,
          status: 'added',
        };
      }
      return {
        path: file.new_path,
        status: 'modified',
        previousPath: file.old_path,
      };
    });

    return {
      id: mr.id,
      number: mr.iid,
      title: mr.title,
      url: mr.web_url,
      headRef: mr.source_branch,
      headSha,
      baseRef: mr.target_branch,
      baseSha,
      files,
    };
  }

  async createComment(id: number, body: string): Promise<void> {
    this.requireToken('create notes');
    await this.request(`/projects/${this.project}/merge_requests/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async setCommitStatus(sha: string, payload: CommitStatusPayload): Promise<void> {
    this.requireToken('update commit statuses');
    const mappedState = this.mapStatus(payload.state);
    const body = {
      state: mappedState,
      description: payload.description,
      target_url: payload.targetUrl,
      context: payload.context ?? 'repo-tokenizer/index',
    };
    await this.request(`/projects/${this.project}/statuses/${sha}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private mapStatus(state: CommitStatusPayload['state']): 'pending' | 'success' | 'failed' {
    switch (state) {
      case 'pending':
        return 'pending';
      case 'success':
        return 'success';
      case 'failure':
      case 'error':
      default:
        return 'failed';
    }
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    return (await response.json()) as T;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${this.apiBase}${path}`;
    const headers = this.buildHeaders(init.headers);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await this.fetchImpl(url, {
      ...init,
      headers,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`GitLab API request failed (${response.status} ${response.statusText}): ${text}`);
    }
    return response;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra ?? {});
    if (this.token) {
      // Support both modern OAuth bearer and legacy private token headers.
      headers.set('authorization', `Bearer ${this.token}`);
      headers.set('private-token', this.token);
    }
    headers.set('accept', 'application/json');
    headers.set('user-agent', 'repo-tokenizer/0.1');
    return headers;
  }

  private requireToken(action: string): void {
    if (!this.token) {
      throw new Error(`GitLab token required to ${action}`);
    }
  }
}
