import {
  type CommitStatusPayload,
  type FetchLike,
  type GitHubProviderOptions,
  type GitProvider,
  type PullRequestDetails,
  type PullRequestFile,
} from './types';

interface GithubPullRequest {
  id: number;
  number: number;
  title: string;
  html_url: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
}

interface GithubPullFile {
  filename: string;
  status: string;
  previous_filename?: string;
}

export class GitHubProvider implements GitProvider {
  readonly kind = 'github';

  private readonly owner: string;
  private readonly repo: string;
  private readonly token?: string;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GitHubProviderOptions, fetchImpl: FetchLike) {
    if (!options.owner || !options.repo) {
      throw new Error('GitHub provider requires both "owner" and "repo" options');
    }

    this.owner = options.owner;
    this.repo = options.repo;
    this.token = options.token ?? (options.tokenEnv ? process.env[options.tokenEnv] : undefined);
    this.apiBase = options.apiBaseUrl ?? 'https://api.github.com';
    this.fetchImpl = fetchImpl;
  }

  async fetchPullRequest(id: number): Promise<PullRequestDetails> {
    const pr = await this.requestJson<GithubPullRequest>(`/repos/${this.owner}/${this.repo}/pulls/${id}`);
    const filesResponse = await this.paginateJson<GithubPullFile>(`/repos/${this.owner}/${this.repo}/pulls/${id}/files`);
    const files = filesResponse.map(this.mapFile);

    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      baseRef: pr.base.ref,
      baseSha: pr.base.sha,
      files,
    };
  }

  async createComment(id: number, body: string): Promise<void> {
    this.requireToken('create comments');
    await this.request(`/repos/${this.owner}/${this.repo}/issues/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async setCommitStatus(sha: string, payload: CommitStatusPayload): Promise<void> {
    this.requireToken('update commit statuses');
    const body = {
      state: payload.state,
      description: payload.description,
      context: payload.context ?? 'repo-tokenizer/index',
      target_url: payload.targetUrl,
    };
    await this.request(`/repos/${this.owner}/${this.repo}/statuses/${sha}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private mapFile = (file: GithubPullFile): PullRequestFile => ({
    path: file.filename,
    status: this.mapStatus(file.status),
    previousPath: file.previous_filename,
  });

  private mapStatus(status: string): PullRequestFile['status'] {
    switch (status) {
      case 'added':
      case 'modified':
      case 'removed':
        return status;
      case 'renamed':
        return 'renamed';
      default:
        return 'modified';
    }
  }

  private async paginateJson<T>(path: string): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    while (true) {
      const separator = path.includes('?') ? '&' : '?';
      const response = await this.request(`${path}${separator}per_page=100&page=${page}`);
      const data = (await response.json()) as T[];
      results.push(...data);
      if (!this.hasNextPage(response)) {
        break;
      }
      page += 1;
    }
    return results;
  }

  private hasNextPage(response: Response): boolean {
    const link = response.headers.get('link');
    if (!link) {
      return false;
    }
    return link.split(',').some((section) => section.includes('rel="next"'));
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
      throw new Error(`GitHub API request failed (${response.status} ${response.statusText}): ${text}`);
    }

    return response;
  }

  private buildHeaders(extra?: HeadersInit): Headers {
    const headers = new Headers(extra ?? {});
    headers.set('accept', 'application/vnd.github+json');
    headers.set('user-agent', 'repo-tokenizer/0.1');
    if (this.token) {
      headers.set('authorization', `Bearer ${this.token}`);
    }
    return headers;
  }

  private requireToken(action: string): void {
    if (!this.token) {
      throw new Error(`GitHub token required to ${action}`);
    }
  }
}
