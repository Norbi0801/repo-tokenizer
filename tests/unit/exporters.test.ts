import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { exportIndexToJsonl } from '../../src/exporters/jsonl';
import type { IndexResult } from '../../src/indexer';

describe('exportIndexToJsonl', () => {
  it('writes files, chunks and secret findings', async () => {
    const index: IndexResult = {
      spec: { type: 'filesystem', path: '/tmp/repo' },
      ref: 'abc123',
      files: [
        {
          path: 'src/app.ts',
          size: 50,
          hash: 'hash1',
          language: 'TypeScript',
          executable: false,
        },
      ],
      chunks: [
        {
          id: 'chunk-1',
          text: 'console.log("hello")',
          fileHash: 'hash1',
          metadata: {
            origin: 'file',
            path: 'src/app.ts',
            startLine: 1,
            endLine: 1,
            tokenCount: 4,
            charCount: 21,
            chunkIndex: 0,
            totalChunks: 1,
          },
        },
      ],
      createdAt: new Date().toISOString(),
      fileLanguageByHash: {
        hash1: 'TypeScript',
      },
      fileContents: {
        'src/app.ts': 'console.log("hello")',
      },
      secretFindings: [
        {
          path: 'src/app.ts',
          line: 1,
          ruleId: 'test-rule',
          excerpt: 'MY_SECRET=abc',
        },
      ],
    };

    const stream = new PassThrough();
    const lines: string[] = [];
    stream.on('data', (chunk) => lines.push(chunk.toString('utf8')));

    await exportIndexToJsonl(index, stream);
    stream.end();

    const output = lines.join('');
    expect(output).toContain('"type":"file"');
    expect(output).toContain('"type":"chunk"');
    expect(output).toContain('"type":"secret_finding"');
    expect(output).toContain('"ruleId":"test-rule"');
  });
});
