import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import yaml from 'js-yaml';
import toml from 'toml';
import { RepoTokenizerConfig } from './types';

export async function loadConfig(path: string, profile?: string): Promise<RepoTokenizerConfig> {
  const absolute = resolve(path);
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
    return mergeConfigs(parsed, profileConfig);
  }

  return parsed;
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
    repository: overlay.repository ?? base.repository,
  };
}
