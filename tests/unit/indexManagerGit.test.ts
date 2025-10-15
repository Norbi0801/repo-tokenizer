import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const openRepositoryMock = vi.fn();

vi.mock('../../src/ingest', async () => {
  const actual = await vi.importActual<typeof import('../../src/ingest')>('../../src/ingest');
  return {
    ...actual,
    openRepository: openRepositoryMock,
  };
});

let IndexManagerClass: typeof import('../../src/indexer').IndexManager;

beforeEach(async () => {
  ({ IndexManager: IndexManagerClass } = await import('../../src/indexer'));
  openRepositoryMock.mockReset();
});

async function withTempRepo(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'repo-tokenizer-indexer-git-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('IndexManager git integrations', () => {
  it('updates submodules and installs LFS by default', async () => {
    await withTempRepo(async (repoDir) => {
      await writeFile(join(repoDir, 'file.txt'), 'hello');

      const updateSubmodules = vi.fn(async () => {});
      const installLfs = vi.fn(async () => {});
      const createSnapshot = vi.fn(async () => ({
        path: repoDir,
        commit: 'abc123',
        cleanup: vi.fn(async () => {}),
      }));
      const listFiles = vi.fn(async () => [
        { path: 'file.txt', size: 5, executable: false },
      ]);

      openRepositoryMock.mockResolvedValueOnce({
        type: 'git',
        repository: {
          updateSubmodules,
          installLfs,
          createSnapshot,
          listFiles,
          cleanup: vi.fn(async () => {}),
        },
        cleanup: vi.fn(async () => {}),
      });

      const manager = new IndexManagerClass();
      const result = await manager.indexRepository({ type: 'git', path: repoDir }, {
        scanSecrets: false,
      });

      expect(result.files).toHaveLength(1);
      expect(updateSubmodules).toHaveBeenCalled();
      expect(installLfs).toHaveBeenCalled();
    });
  });

  it('can disable submodule and LFS helpers via options', async () => {
    await withTempRepo(async (repoDir) => {
      await writeFile(join(repoDir, 'file.txt'), 'hello');

      const updateSubmodules = vi.fn(async () => {});
      const installLfs = vi.fn(async () => {});
      const createSnapshot = vi.fn(async () => ({
        path: repoDir,
        commit: 'def456',
        cleanup: vi.fn(async () => {}),
      }));
      const listFiles = vi.fn(async () => [
        { path: 'file.txt', size: 5, executable: false },
      ]);

      openRepositoryMock.mockResolvedValueOnce({
        type: 'git',
        repository: {
          updateSubmodules,
          installLfs,
          createSnapshot,
          listFiles,
          cleanup: vi.fn(async () => {}),
        },
        cleanup: vi.fn(async () => {}),
      });

      const manager = new IndexManagerClass();
      await manager.indexRepository({ type: 'git', path: repoDir }, {
        scanSecrets: false,
        gitSubmodules: false,
        gitLfs: false,
      });

      expect(updateSubmodules).not.toHaveBeenCalled();
      expect(installLfs).not.toHaveBeenCalled();
    });
  });
});
