import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config';

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'repo-tokenizer-config-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Config loader', () => {
  it('loads YAML config and merges profiles', async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, 'config.yaml');
      await writeFile(
        configPath,
        `repository:\n  type: filesystem\n  path: ./repo\nindexing:\n  tokenizerId: basic\nprofiles:\n  ci:\n    indexing:\n      tokenizerId: sentencepiece\n`,
      );

      const base = await loadConfig(configPath);
      expect(base.repository.path).toBe('./repo');
      expect(base.indexing?.tokenizerId).toBe('basic');

      const profile = await loadConfig(configPath, 'ci');
      expect(profile.indexing?.tokenizerId).toBe('sentencepiece');
    });
  });

  it('throws when repository section is missing', async () => {
    await withTempDir(async (dir) => {
      const configPath = join(dir, 'broken.toml');
      await writeFile(configPath, `indexing = { tokenizerId = "basic" }`);

      await expect(loadConfig(configPath)).rejects.toThrow(/repository/);
    });
  });
});
