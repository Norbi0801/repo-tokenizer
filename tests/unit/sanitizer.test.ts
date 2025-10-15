import { describe, it, expect } from 'vitest';
import { ContentSanitizer } from '../../src/normalization/sanitizer';

describe('ContentSanitizer', () => {
  it('applies rules and tracks ids', () => {
    const sanitizer = new ContentSanitizer({
      rules: [
        { id: 'secrets', description: 'Mask secrets', pattern: /(API_KEY=)(\w+)/g, replacement: '$1***' },
      ],
    });

    const input = 'API_KEY=abcd1234';
    const { sanitized, appliedRules } = sanitizer.sanitize(input);
    expect(sanitized).toBe('API_KEY=***');
    expect(appliedRules).toContain('secrets');
  });
});
