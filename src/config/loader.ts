import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, isAbsolute } from 'node:path';
import yaml from 'js-yaml';
import toml from 'toml';
import { RepoTokenizerConfig } from './types';

export async function loadConfig(path: string, profile?: string): Promise<RepoTokenizerConfig> {
  const absolute = resolve(path);
  const baseDir = dirname(absolute);
  const contents = await readFile(absolute, 'utf8');
  const ext = extname(absolute).toLowerCase();
  let parsed: RepoTokenizerConfig;

  switch (ext) {
    case '.yaml':
    case '.yml':
      parsed = yaml.load(contents) as RepoTokenizerConfig;
      break;
    case '.toml':
      parsed = toml.parse(contents) as RepoTokenizerConfig;
      break;
    case '.json':
      parsed = JSON.parse(contents) as RepoTokenizerConfig;
      break;
    default:
      throw new Error(`Unsupported config format for ${absolute}`);
  }

  if (!parsed.repository) {
    throw new Error('Config must define "repository" section');
  }

  if (profile) {
    const profileConfig = parsed.profiles?.[profile];
    if (!profileConfig) {
      throw new Error(`Profile ${profile} not found in config`);
    }
    return normalizeConfigPaths(mergeConfigs(parsed, profileConfig), baseDir);
  }

  return normalizeConfigPaths(parsed, baseDir);
}

function mergeConfigs(base: RepoTokenizerConfig, overlay: Partial<Omit<RepoTokenizerConfig, 'profiles'>>): RepoTokenizerConfig {
  return {
    ...base,
    indexing: {
      ...base.indexing,
      ...overlay.indexing,
    },
    export: {
      ...base.export,
      ...overlay.export,
    },
    server: {
      ...base.server,
      ...overlay.server,
    },
    integrations: mergeIntegrations(base.integrations, overlay.integrations),
    repository: overlay.repository ?? base.repository,
  };
}

function mergeIntegrations(
  base?: RepoTokenizerConfig['integrations'],
  overlay?: RepoTokenizerConfig['integrations'],
): RepoTokenizerConfig['integrations'] {
  if (!base && !overlay) {
    return undefined;
  }

  const github = base?.github && overlay?.github
    ? { ...base.github, ...overlay.github }
    : overlay?.github ?? base?.github;

  const gitlab = base?.gitlab && overlay?.gitlab
    ? { ...base.gitlab, ...overlay.gitlab }
    : overlay?.gitlab ?? base?.gitlab;

  const pullRequests = {
    ...base?.pullRequests,
    ...overlay?.pullRequests,
  };

  const result: RepoTokenizerConfig['integrations'] = {};
  if (github) {
    result.github = github;
  }
  if (gitlab) {
    result.gitlab = gitlab;
  }
  if (pullRequests && Object.keys(pullRequests).length > 0) {
    result.pullRequests = pullRequests;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeConfigPaths(config: RepoTokenizerConfig, baseDir: string): RepoTokenizerConfig {
  const repoPath = config.repository.path;
  const absolutePath = isAbsolute(repoPath) ? repoPath : resolve(baseDir, repoPath);
  if (absolutePath === repoPath) {
    return config;
  }
  return {
    ...config,
    repository: {
      ...config.repository,
      path: absolutePath,
    },
  };
}
