import {
  type FetchLike,
  type GitHubProviderOptions,
  type GitLabProviderOptions,
  type GitProvider,
  type GitProviderKind,
} from './types';
import { GitHubProvider } from './github';
import { GitLabProvider } from './gitlab';

export * from './types';
export { GitHubProvider } from './github';
export { GitLabProvider } from './gitlab';

export interface ProviderConfigMap {
  github?: GitHubProviderOptions;
  gitlab?: GitLabProviderOptions;
}

function ensureFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl) {
    return fetchImpl;
  }
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }
  throw new Error('No fetch implementation available for Git provider integration');
}

export function createGitProvider(
  kind: GitProviderKind,
  configs: ProviderConfigMap,
  fetchImpl?: FetchLike,
): GitProvider {
  const effectiveFetch = ensureFetch(fetchImpl);

  switch (kind) {
    case 'github': {
      const options = configs.github;
      if (!options) {
        throw new Error('GitHub provider configuration missing');
      }
      return new GitHubProvider(options, effectiveFetch);
    }
    case 'gitlab': {
      const options = configs.gitlab;
      if (!options) {
        throw new Error('GitLab provider configuration missing');
      }
      return new GitLabProvider(options, effectiveFetch);
    }
    default:
      throw new Error(`Unsupported git provider kind: ${String(kind)}`);
  }
}
