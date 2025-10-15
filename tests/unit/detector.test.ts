import { describe, it, expect } from 'vitest';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { FileDetector } from '../../src/normalization/detector';

async function createTempFile(name: string, content: Buffer | string): Promise<string> {
  const tmpDir = join(process.cwd(), 'tmp-tests');
  const filePath = join(tmpDir, name);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

describe('FileDetector', () => {
  it('detects binary by extension and size', async () => {
    const detector = new FileDetector();
    const path = await createTempFile('image.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const result = await detector.inspect(path);
    expect(result.isBinary).toBe(true);
  });

  it('detects generated file by directory', async () => {
    const detector = new FileDetector();
    const path = await createTempFile('dist/app.js', 'console.log("hello");');
    const result = await detector.inspect(path);
    expect(result.isGenerated).toBe(true);
  });

  it('marks large files based on configurable threshold', async () => {
    const detector = new FileDetector({ largeFileThresholdBytes: 4 });
    const path = await createTempFile('big.txt', 'abcdef');
    const result = await detector.inspect(path);
    expect(result.isLarge).toBe(true);
  });
});
