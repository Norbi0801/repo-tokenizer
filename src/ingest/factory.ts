import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { FilesystemRepository } from './filesystem';
import { GitRepository, GitRepositoryConfig } from './git';
import { openArchive } from './archive';
import { RepositorySpec } from './types';

export interface OpenRepositoryResult {
  type: 'git' | 'filesystem';
  repository: GitRepository | FilesystemRepository;
  cleanup?: () => Promise<void>;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function looksLikeGitRepository(path: string): Promise<boolean> {
  return pathExists(join(path, '.git'));
}

export async function openRepository(spec: RepositorySpec): Promise<OpenRepositoryResult> {
  if (spec.type === 'archive') {
    const { repository, cleanup } = await openArchive(spec.path, {
      archiveType: spec.archiveType,
    });
    return { type: 'filesystem', repository, cleanup };
  }

  if (spec.type === 'filesystem') {
    if (await looksLikeGitRepository(spec.path)) {
      const repo = await GitRepository.open({ path: spec.path });
      return { type: 'git', repository: repo };
    }
    const fsRepo = new FilesystemRepository(spec.path);
    return { type: 'filesystem', repository: fsRepo };
  }

  const gitConfig: GitRepositoryConfig = {
    path: spec.path,
    url: spec.url,
  };
  const repo = await GitRepository.open(gitConfig);
  return { type: 'git', repository: repo };
}
