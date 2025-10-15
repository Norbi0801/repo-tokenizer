import { describe, it, expect } from 'vitest';
import { ContentNormalizer } from '../../src/normalization/normalize';

describe('ContentNormalizer', () => {
  it('removes BOM and normalizes line endings', () => {
    const normalizer = new ContentNormalizer({ removeBom: true, normalizeLineEndings: 'lf' });
    const input = '\uFEFFfoo\r\nbar\r\nbaz';
    const result = normalizer.normalize(input);
    expect(result.normalized).toBe('foo\nbar\nbaz');
    expect(result.removedBom).toBe(true);
    expect(result.normalizedLineEndings).toBe(true);
  });

  it('trims trailing whitespace with markdown tables preserved', () => {
    const normalizer = new ContentNormalizer({
      trimTrailingWhitespace: true,
      preserveMarkdownTables: true,
    });
    const input = 'value | value   \nplain   ';
    const result = normalizer.normalize(input);
    expect(result.normalized).toBe('value | value \nplain');
    expect(result.trimmedTrailingWhitespace).toBe(true);
  });
});
