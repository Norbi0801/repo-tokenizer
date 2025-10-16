import { describe, it, expect } from 'vitest';
import { DomainPolicyEngine } from '../../src/domain/engine';

describe('DomainPolicyEngine', () => {
  it('denies files with blocked licenses', () => {
    const engine = new DomainPolicyEngine({ license: { denied: ['MIT'] } });
    const result = engine.evaluate({ path: 'LICENSE', content: 'MIT License Permission is hereby granted' });
    expect(result.action).toBe('deny');
    expect(result.findings[0]?.type).toBe('license');
  });

  it('anonymises PII tokens', () => {
    const engine = new DomainPolicyEngine({ pii: { enabled: true, replacement: '[redacted]' } });
    const result = engine.evaluate({ path: 'app.txt', content: 'Contact me at user@example.com' });
    expect(result.action).toBe('allow');
    expect(result.content).toContain('[redacted]');
    expect(result.findings.some((finding) => finding.type === 'pii')).toBe(true);
  });
});
