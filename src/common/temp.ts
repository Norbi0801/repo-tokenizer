import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Create a temporary directory under the OS tmp dir.
 * Call `cleanup` to remove it recursively.
 */
export async function createTemporaryDirectory(prefix = 'repo-tokenizer-') {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}${randomUUID()}-`));
  return {
    path: dir,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
