import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execMocks = vi.hoisted(() => ({
  runCommandMock: vi.fn(),
}));

vi.mock('../../src/common/exec', () => ({
  runCommand: execMocks.runCommandMock,
}));

import { GitRepository } from '../../src/ingest/git';

async function createRepoPath() {
  return mkdtemp(join(tmpdir(), 'repo-tokenizer-gitrepo-'));
}

beforeEach(() => {
  execMocks.runCommandMock.mockReset();
});

describe('GitRepository helpers', () => {
  it('updateSubmodules triggers git submodule update', async () => {
    const repoPath = await createRepoPath();
    try {
      execMocks.runCommandMock.mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === 'rev-parse') {
          return { stdout: 'true', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const repo = await GitRepository.open({ path: repoPath });
      execMocks.runCommandMock.mockClear();
      await repo.updateSubmodules();

      expect(execMocks.runCommandMock).toHaveBeenCalledWith(
        'git',
        ['submodule', 'update', '--init', '--recursive'],
        expect.objectContaining({ cwd: repoPath }),
      );
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it('installLfs triggers git lfs install', async () => {
    const repoPath = await createRepoPath();
    try {
      execMocks.runCommandMock.mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === 'rev-parse') {
          return { stdout: 'true', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const repo = await GitRepository.open({ path: repoPath });
      execMocks.runCommandMock.mockClear();
      await repo.installLfs();

      expect(execMocks.runCommandMock).toHaveBeenCalledWith(
        'git',
        ['lfs', 'install', '--local'],
        expect.objectContaining({ cwd: repoPath }),
      );
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it('listChangedFiles parses git diff output', async () => {
    const repoPath = await createRepoPath();
    try {
      execMocks.runCommandMock.mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === 'rev-parse') {
          return { stdout: 'true', stderr: '' };
        }
        if (args[0] === 'diff') {
          return { stdout: 'M\tsrc/app.ts\nD\tREADME.md\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      const repo = await GitRepository.open({ path: repoPath });
      const result = await repo.listChangedFiles('base', 'head');
      expect(result.changed).toEqual(['src/app.ts']);
      expect(result.deleted).toEqual(['README.md']);
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});
