import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import type { Cipher } from 'node:crypto';

const MAGIC = Buffer.from('RPTK1');

interface EncryptedWriter {
  stream: Cipher;
  finalize: () => Promise<void>;
}

export function createEncryptedFileWriter(path: string, password: string): EncryptedWriter {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const out = createWriteStream(path, { encoding: 'binary' });
  out.write(Buffer.concat([MAGIC, salt, iv]));
  cipher.pipe(out, { end: false });

  return {
    stream: cipher,
    finalize: async () => {
      cipher.end();
      await once(cipher, 'finish');
      const tag = cipher.getAuthTag();
      out.write(tag);
      await new Promise<void>((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    },
  };
}

export function encryptBuffer(buffer: Buffer, password: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, encrypted, tag]);
}
