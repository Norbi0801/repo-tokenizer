export interface RepoTokenizerClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
}

export class RepoTokenizerClient {
  constructor(private readonly options: RepoTokenizerClientOptions) {}

  async listFiles(params: { include?: string; exclude?: string; ref?: string } = {}) {
    const query = new URLSearchParams();
    if (params.include) query.set('include', params.include);
    if (params.exclude) query.set('exclude', params.exclude);
    if (params.ref) query.set('ref', params.ref);
    return this.request<{ files: unknown[] }>(`/files?${query.toString()}`);
  }

  async listChunks(params: { path?: string; lang?: string; ref?: string; maxTokens?: number } = {}) {
    const query = new URLSearchParams();
    if (params.path) query.set('path', params.path);
    if (params.lang) query.set('lang', params.lang);
    if (params.ref) query.set('ref', params.ref);
    if (params.maxTokens) query.set('maxTokens', String(params.maxTokens));
    return this.request<{ chunks: unknown[] }>(`/chunks?${query.toString()}`);
  }

  async getChunk(id: string, params: { ref?: string } = {}) {
    const query = params.ref ? `?ref=${encodeURIComponent(params.ref)}` : '';
    return this.request<{ chunk: unknown }>(`/chunks/${encodeURIComponent(id)}${query}`);
  }

  async search(query: string, params: { pathGlob?: string; ref?: string } = {}) {
    const qs = new URLSearchParams({ q: query });
    if (params.pathGlob) qs.set('pathGlob', params.pathGlob);
    if (params.ref) qs.set('ref', params.ref);
    return this.request<{ matches: unknown[] }>(`/search?${qs.toString()}`);
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.options.baseUrl}${path}`;
    const response = await fetch(url, {
      headers: {
        'content-type': 'application/json',
        ...(this.options.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Request failed (${response.status}): ${text}`);
    }
    return (await response.json()) as T;
  }
}
