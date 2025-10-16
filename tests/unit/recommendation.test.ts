import { describe, it, expect } from 'vitest';
import { buildRecommendations } from '../../src/recommendation';
import type { IndexResult } from '../../src/indexer';

const INDEX: IndexResult = {
  spec: { type: 'filesystem', path: '/tmp/repo' },
  ref: 'main',
  files: [
    { path: 'src/app.ts', size: 100, hash: 'hash-app', language: 'TypeScript', executable: false },
  ],
  chunks: [
    {
      id: 'chunk-app',
      text: 'function hello() { return 42; }',
      fileHash: 'hash-app',
      metadata: {
        origin: 'file',
        path: 'src/app.ts',
        startLine: 1,
        endLine: 3,
        tokenCount: 10,
        charCount: 32,
        chunkIndex: 0,
        totalChunks: 1,
      },
    },
  ],
  createdAt: new Date().toISOString(),
  fileLanguageByHash: { 'hash-app': 'TypeScript' },
  fileContents: { 'src/app.ts': 'function hello() { return 42; }' },
  secretFindings: [{ path: 'src/app.ts', line: 2, ruleId: 'secret', excerpt: 'API_KEY=123' }],
  domainFindings: [{ path: 'src/app.ts', type: 'pii', message: 'PII token redacted' }],
};

describe('buildRecommendations', () => {
  it('produces multiple recommendation tracks', () => {
    const recommendations = buildRecommendations(INDEX, { limit: 3 });
    expect(recommendations.length).toBeGreaterThan(1);
    const labels = recommendations.map((rec) => rec.label);
    expect(labels.some((label) => label.includes('Secret'))).toBe(true);
  });
});
