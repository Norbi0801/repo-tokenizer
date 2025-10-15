import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../common/exec';
import { createTemporaryDirectory } from '../common/temp';
import { FilesystemRepository } from './filesystem';

export type ArchiveType = 'tar' | 'zip';

export interface ArchiveOpenOptions {
  archiveType?: ArchiveType;
}

function detectArchiveType(path: string): ArchiveType {
  const lower = path.toLowerCase();
  if (lower.endsWith('.zip')) {
    return 'zip';
  }
  if (
    lower.endsWith('.tar') ||
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tbz')
  ) {
    return 'tar';
  }
  throw new Error(`Unable to detect archive type for ${path}`);
}

async function extractTar(archivePath: string, destination: string) {
  await runCommand('tar', ['-xf', archivePath, '-C', destination]);
}

async function extractZip(archivePath: string, destination: string) {
  await runCommand('unzip', ['-q', archivePath, '-d', destination]);
}

async function detectRootDirectory(destination: string): Promise<string> {
  const entries = await readdir(destination, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1 && entries.every((entry) => entry.isDirectory())) {
    return join(destination, directories[0].name);
  }
  return destination;
}

export async function openArchive(path: string, options: ArchiveOpenOptions = {}) {
  const archiveType = options.archiveType ?? detectArchiveType(path);
  const temp = await createTemporaryDirectory('repo-archive-');

  if (archiveType === 'tar') {
    await extractTar(path, temp.path);
  } else {
    await extractZip(path, temp.path);
  }

  const root = await detectRootDirectory(temp.path);
  return {
    repository: new FilesystemRepository(root),
    cleanup: temp.cleanup,
    rootPath: root,
  };
}
