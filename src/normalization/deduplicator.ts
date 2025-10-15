import { createHash } from 'node:crypto';

interface DedupEntry {
  hash: string;
  id: string;
}

export class ContentDeduplicator {
  private readonly seen = new Map<string, DedupEntry>();

  constructor(private readonly algorithm: string = 'sha256') {}

  computeHash(text: string): string {
    const hash = createHash(this.algorithm);
    hash.update(text);
    return hash.digest('hex');
  }

  isDuplicate(text: string, idHint: string): { duplicate: boolean; hash: string; existingId?: string } {
    const hash = this.computeHash(text);
    const existing = this.seen.get(hash);
    if (existing) {
      return { duplicate: true, hash, existingId: existing.id };
    }
    this.seen.set(hash, { hash, id: idHint });
    return { duplicate: false, hash };
  }

  clear(): void {
    this.seen.clear();
  }
}
