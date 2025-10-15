import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { createDecipheriv, scryptSync } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEncryptedFileWriter, encryptBuffer } from '../../src/exporters/encryption';

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'repo-tokenizer-enc-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('Encryption utilities', () => {
  it('encryptBuffer produces decryptable payload', () => {
    const password = 'secret';
    const buffer = Buffer.from('hello world', 'utf8');
    const encrypted = encryptBuffer(buffer, password);
    expect(encrypted.slice(0, 5).toString()).toBe('RPTK1');

    const salt = encrypted.slice(5, 21);
    const iv = encrypted.slice(21, 33);
    const data = encrypted.slice(33, -16);
    const tag = encrypted.slice(-16);

    const key = scryptSync(password, salt, 32);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    expect(decrypted.toString()).toBe('hello world');
  });

  it('createEncryptedFileWriter writes encrypted data', async () => {
    await withTempDir(async (dir) => {
      const output = join(dir, 'out.enc');
      const password = 'pass123';
      const writer = createEncryptedFileWriter(output, password);
      writer.stream.write('streamed data');
      await writer.finalize();

      const encrypted = await readFile(output);
      expect(encrypted.slice(0, 5).toString()).toBe('RPTK1');

      const salt = encrypted.slice(5, 21);
      const iv = encrypted.slice(21, 33);
      const data = encrypted.slice(33, -16);
      const tag = encrypted.slice(-16);

      const key = scryptSync(password, salt, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      expect(decrypted.toString()).toBe('streamed data');
    });
  });
});
