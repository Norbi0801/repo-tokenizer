import { describe, it, expect } from 'vitest';
import { buildQualityReport } from '../../src/reports/quality';
import { IndexResult } from '../../src/indexer/types';

function createIndexResult(overrides: Partial<IndexResult> = {}): IndexResult {
  return {
    spec: { type: 'filesystem', path: '/tmp/repo' },
    ref: 'HEAD',
    files: [
      { path: 'a.ts', size: 10, hash: 'hash-a', language: 'typescript', executable: false },
      { path: 'b.py', size: 20, hash: 'hash-b', language: 'python', executable: false },
    ],
    chunks: [
      {
        id: 'chunk-a-1',
        text: 'chunk-a',
        metadata: {
          path: 'a.ts',
          startLine: 1,
          endLine: 10,
          tokenCount: 50,
          origin: 'file',
          charCount: 7,
          chunkIndex: 0,
          totalChunks: 1,
        },
        fileHash: 'hash-a',
      },
      {
        id: 'chunk-b-1',
        text: 'chunk-b',
        metadata: {
          path: 'b.py',
          startLine: 1,
          endLine: 20,
          tokenCount: 120,
          origin: 'file',
          charCount: 7,
          chunkIndex: 0,
          totalChunks: 1,
        },
        fileHash: 'hash-b',
      },
    ],
    createdAt: new Date().toISOString(),
    fileLanguageByHash: { 'hash-a': 'typescript', 'hash-b': 'python' },
    fileContents: { 'a.ts': 'chunk-a', 'b.py': 'chunk-b' },
    secretFindings: [{ path: 'b.py', line: 1, ruleId: 'test', excerpt: 'secret' }],
    ...overrides,
  };
}

describe('buildQualityReport', () => {
  it('summarises index metrics', () => {
    const current = createIndexResult();
    const report = buildQualityReport(current);
    expect(report.totals.files).toBe(2);
    expect(report.totals.chunks).toBe(2);
    expect(report.totals.tokens).toBe(170);
    expect(report.secrets.findings).toBe(1);
    expect(report.languages.some((item) => item.language === 'typescript')).toBe(true);
    expect(report.chunkDistribution.length).toBeGreaterThan(0);
    expect(report.diff).toBeUndefined();
  });

  it('computes diff against baseline', () => {
    const baseline = createIndexResult({
      files: [
        { path: 'a.ts', size: 10, hash: 'hash-a-old', language: 'typescript', executable: false },
        { path: 'c.go', size: 15, hash: 'hash-c', language: 'go', executable: false },
      ],
      chunks: [
        {
          id: 'chunk-old',
          text: 'old',
          metadata: {
            path: 'a.ts',
            startLine: 1,
            endLine: 5,
            tokenCount: 30,
            origin: 'file',
            charCount: 3,
            chunkIndex: 0,
            totalChunks: 1,
          },
          fileHash: 'hash-a-old',
        },
      ],
      fileLanguageByHash: { 'hash-a-old': 'typescript', 'hash-c': 'go' },
      fileContents: { 'a.ts': 'old', 'c.go': 'content' },
    });
    const current = createIndexResult();
    const report = buildQualityReport(current, baseline);
    expect(report.diff).toBeDefined();
    expect(report.diff?.addedFiles).toContain('b.py');
    expect(report.diff?.removedFiles).toContain('c.go');
    expect(report.diff?.changedFiles).toContain('a.ts');
    expect(report.diff?.addedChunks).toBeGreaterThan(0);
    expect(report.diff?.removedChunks).toBeGreaterThan(0);
  });
});
