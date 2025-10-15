import { describe, it, expect } from 'vitest';
import { ContentDeduplicator } from '../../src/normalization/deduplicator';

describe('ContentDeduplicator', () => {
  it('detects duplicates by hash', () => {
    const dedup = new ContentDeduplicator();
    const first = dedup.isDuplicate('hello', 'chunk-1');
    expect(first.duplicate).toBe(false);
    const second = dedup.isDuplicate('hello', 'chunk-2');
    expect(second.duplicate).toBe(true);
    expect(second.existingId).toBe('chunk-1');
  });
});
