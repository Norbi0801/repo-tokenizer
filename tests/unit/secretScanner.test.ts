import { describe, it, expect } from 'vitest';
import { SecretScanner, mergeSecretPatterns } from '../../src/normalization/secretScanner';

describe('SecretScanner', () => {
  it('detects secrets using default patterns', () => {
    const scanner = new SecretScanner();
    const text = 'const token = "Bearer abcdefghijklmnop";\nAKIA1234567890ABCDEF';
    const findings = scanner.scan(text, 'example.js');
    const ruleIds = findings.map((finding) => finding.ruleId);
    expect(ruleIds).toContain('generic-bearer-token');
    expect(ruleIds).toContain('aws-access-key');
    expect(findings.every((finding) => finding.path === 'example.js')).toBe(true);
  });

  it('uses custom patterns merged with defaults', () => {
    const customPatterns = mergeSecretPatterns([
      {
        id: 'custom-secret',
        description: 'Custom secret detector',
        pattern: /MY_SECRET=[A-Z0-9]+/g,
      },
    ]);
    const scanner = new SecretScanner(customPatterns);
    const text = 'safe\nMY_SECRET=ABC123\n';
    const findings = scanner.scan(text, 'custom.env');
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'custom-secret', line: 2 });
  });

  it('returns empty array when no patterns match', () => {
    const scanner = new SecretScanner();
    const text = 'const safe = true;';
    expect(scanner.scan(text, 'safe.ts')).toEqual([]);
  });
});
