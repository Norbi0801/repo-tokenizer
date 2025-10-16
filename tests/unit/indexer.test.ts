import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
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
      expect(result.fileContents['secret.env']).toBe('API_KEY=***');
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
      expect(second.fileContents['b.txt']).toBe('MY_SECRET=***');
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

  it('supports concurrent indexing with sharding metadata', async () => {
    const repoDir = await createTempDir('repo-tokenizer-concurrency-');
    try {
      await writeFile(join(repoDir, 'a.txt'), 'alpha');
      await writeFile(join(repoDir, 'b.txt'), 'bravo');
      await writeFile(join(repoDir, 'c.txt'), 'charlie');

      const result = await manager.indexRepository(
        { type: 'filesystem', path: repoDir },
        {
          concurrency: 3,
          maxInFlightBytes: 32 * 1024,
          sharding: { chunksPerShard: 1 },
        },
      );

      expect(result.shards).toBeDefined();
      expect(result.shards).toHaveLength(result.chunks.length);
      expect(result.shards?.every((shard) => shard.chunkCount === 1)).toBe(true);
      const chunkPaths = result.chunks.map((chunk) => chunk.metadata.path);
      const sortedPaths = [...chunkPaths].sort();
      expect(chunkPaths).toEqual(sortedPaths);
      expect(result.resumeCursor).toBeUndefined();
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('allows resuming indexing with resumeCursor and maxFilesPerRun', async () => {
    const repoDir = await createTempDir('repo-tokenizer-resume-');
    try {
      const files = ['a.txt', 'b.txt', 'c.txt', 'd.txt'];
      await Promise.all(files.map((name, idx) => writeFile(join(repoDir, name), `file-${idx}`)));

      const first = await manager.indexRepository(
        { type: 'filesystem', path: repoDir },
        {
          concurrency: 2,
          maxFilesPerRun: 2,
        },
      );

      expect(first.files.length).toBe(2);
      expect(first.resumeCursor).toBeDefined();

      const resumeCursor = first.resumeCursor!;
      const second = await manager.indexRepository(
        { type: 'filesystem', path: repoDir },
        {
          concurrency: 2,
          maxFilesPerRun: 2,
          resumeCursor,
        },
      );

      expect(second.files.length).toBeGreaterThan(0);
      expect(second.files.every((meta) => meta.path > resumeCursor)).toBe(true);
      expect(second.resumeCursor).toBeUndefined();

      const combined = [...first.files, ...second.files].map((meta) => meta.path).sort();
      expect(combined).toEqual(files);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('applies domain rules to redact PII and block licenses', async () => {
    const repoDir = await createTempDir('repo-tokenizer-domain-');
    try {
      await writeFile(join(repoDir, 'LICENSE'), 'MIT License Permission is hereby granted');
      await writeFile(join(repoDir, 'pii.txt'), 'email john.doe@example.com');

      const result = await manager.indexRepository({ type: 'filesystem', path: repoDir }, {
        domain: {
          license: { denied: ['MIT'] },
          pii: { enabled: true, replacement: '[pii]' },
        },
        scanSecrets: false,
      });

      expect(result.files.some((file) => file.path === 'pii.txt')).toBe(true);
      expect(result.fileContents['pii.txt']).toContain('[pii]');
      expect(result.files.some((file) => file.path === 'LICENSE')).toBe(false);
      expect(result.domainFindings?.some((finding) => finding.type === 'license')).toBe(true);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('applies language-specific chunk profiles', async () => {
    const repoDir = await createTempDir('repo-tokenizer-profiles-');
    try {
      const lines = Array.from({ length: 30 }, (_, index) => `console.log(${index});`).join('\n');
      await writeFile(join(repoDir, 'index.ts'), lines);

      const result = await manager.indexRepository({ type: 'filesystem', path: repoDir }, {
        chunking: { strategy: 'lines', targetLines: 50 },
        languageChunkProfiles: {
          typescript: {
            targetLines: 10,
          },
        },
      });

      expect(result.chunks.length).toBeGreaterThan(1);
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('produces test coverage mapping and dependency graph', async () => {
    const repoDir = await createTempDir('repo-tokenizer-mapping-');
    try {
      await mkdir(join(repoDir, 'src'), { recursive: true });
      await writeFile(join(repoDir, 'src', 'foo.ts'), "import './bar';\nexport const value = 1;\n");
      await writeFile(join(repoDir, 'src', 'bar.ts'), 'export const other = 2;');
      await writeFile(join(repoDir, 'src', 'foo.test.ts'), "import { value } from './foo';\nconsole.log(value);\n");

      const result = await manager.indexRepository({ type: 'filesystem', path: repoDir }, {
        scanSecrets: false,
      });

      expect(result.testCoverage?.['src/foo.test.ts']).toContain('src/foo.ts');
      const deps = result.dependencyGraph?.['src/foo.ts'] ?? [];
      expect(deps.some((entry) => entry.startsWith('src/bar'))).toBe(true);
      expect(result.symbolIndex).toBeDefined();
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
