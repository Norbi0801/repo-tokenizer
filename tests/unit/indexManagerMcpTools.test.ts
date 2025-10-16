import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { IndexManager } from '../../src/indexer';

function runGit(repo: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  execFileSync('git', args, {
    cwd: repo,
    env: { ...process.env, ...env },
  });
}

async function withGitRepo(fn: (repo: string, commits: { initial: string; updated: string }) => Promise<void>) {
  const repo = await mkdtemp(join(tmpdir(), 'repo-tokenizer-mcp-'));
  try {
    runGit(repo, ['init']);
    runGit(repo, ['config', 'user.name', 'Test User']);
    runGit(repo, ['config', 'user.email', 'test@example.com']);
    await writeFile(join(repo, 'sample.txt'), 'line one\nline two\n');
    runGit(repo, ['add', 'sample.txt']);
    runGit(repo, ['commit', '-m', 'initial']);
    const initial = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

    await writeFile(join(repo, 'sample.txt'), 'line one\nline two updated\nline three\n');
    runGit(repo, ['commit', '-am', 'update']);
    const updated = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();

    await fn(repo, { initial, updated });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
}

describe('IndexManager MCP tools', () => {
  let manager: IndexManager;

  beforeEach(() => {
    manager = new IndexManager();
  });

  it('diffChunks returns added/removed chunks between refs', async () => {
    await withGitRepo(async (repo, commits) => {
      const diff = await manager.diffChunks({ type: 'git', path: repo }, {
        baseRef: commits.initial,
        headRef: commits.updated,
        indexOptions: { scanSecrets: false },
      });
      expect(diff.added.length).toBeGreaterThan(0);
      expect(diff.changedFiles).toContain('sample.txt');
    });
  }, 20000);

  it('blameFile returns author metadata', async () => {
    await withGitRepo(async (repo, commits) => {
      const blame = await manager.blameFile({ type: 'git', path: repo }, { path: 'sample.txt', ref: commits.updated });
      expect(blame.lines.length).toBeGreaterThan(0);
      expect(blame.lines[0].commit).toHaveLength(40);
    });
  }, 20000);

  it('resolveReference resolves commit hash', async () => {
    await withGitRepo(async (repo, commits) => {
      const resolved = await manager.resolveReference({ type: 'git', path: repo }, 'HEAD');
      expect(resolved).toHaveLength(40);
      expect(resolved).toBe(commits.updated);
    });
  }, 20000);

  it('buildContextPack returns ranked chunks', async () => {
    await withGitRepo(async (repo) => {
      const pack = await manager.buildContextPack({ type: 'git', path: repo }, {
        ref: 'HEAD',
        limit: 2,
        indexOptions: { scanSecrets: false },
      });
      expect(pack.chunks.length).toBeGreaterThan(0);
      expect(pack.totalChunks).toBe(pack.chunks.length);
    });
  }, 20000);
});
