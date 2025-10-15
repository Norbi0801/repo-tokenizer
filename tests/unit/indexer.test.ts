import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexManager } from '../../src/indexer';

async function createTempDir(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('IndexManager', () => {
  let manager: IndexManager;

  beforeEach(() => {
    manager = new IndexManager();
  });

  it('indexes filesystem repository and captures secret findings', async () => {
    const dir = await createTempDir('repo-tokenizer-fs-');
    try {
      await writeFile(join(dir, 'safe.txt'), 'hello world');
      await writeFile(join(dir, 'secret.env'), 'API_KEY=super-secret');

      const result = await manager.indexRepository({ type: 'filesystem', path: dir }, {
        scanSecrets: true,
      });

      expect(result.files).toHaveLength(2);
      expect(result.secretFindings).toHaveLength(1);
      expect(result.secretFindings[0]).toMatchObject({
        path: 'secret.env',
        ruleId: 'api-key',
      });
      expect(result.fileContents['safe.txt']).toContain('hello');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('performs incremental indexing for filesystem repository, reusing unchanged files', async () => {
    const repoDir = await createTempDir('repo-tokenizer-fs-incremental-');
    try {
      await writeFile(join(repoDir, 'a.txt'), 'version1');
      await writeFile(join(repoDir, 'b.txt'), 'MY_SECRET=one-two-three');

      const first = await manager.indexRepository({ type: 'filesystem', path: repoDir }, {
        scanSecrets: true,
      });

      expect(first.secretFindings.some((f) => f.path === 'b.txt')).toBe(true);

      await writeFile(join(repoDir, 'a.txt'), 'version2');

      const second = await manager.indexRepository(
        { type: 'filesystem', path: repoDir },
        {
          incremental: true,
          scanSecrets: true,
          includePaths: ['a.txt'],
        },
      );

      expect(second.files).toHaveLength(2);
      expect(second.fileContents['a.txt']).toBe('version2');
      expect(second.fileContents['b.txt']).toBe('MY_SECRET=one-two-three');
      const bSecret = second.secretFindings.find((finding) => finding.path === 'b.txt');
      expect(bSecret).toBeDefined();
      const chunkIdsFirst = first.chunks
        .filter((chunk) => chunk.metadata.path === 'b.txt')
        .map((chunk) => chunk.id);
      const chunkIdsSecond = second.chunks
        .filter((chunk) => chunk.metadata.path === 'b.txt')
        .map((chunk) => chunk.id);
      expect(chunkIdsSecond).toEqual(chunkIdsFirst);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
