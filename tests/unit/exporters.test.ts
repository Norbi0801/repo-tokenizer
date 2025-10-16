import { describe, it, expect } from 'vitest';
import { PassThrough } from 'node:stream';
import { exportIndexToJsonl } from '../../src/exporters/jsonl';
import { buildParquetBuffer } from '../../src/exporters/parquet';
import { buildDeltaSnapshot } from '../../src/exporters/delta';
import { buildVectorRecords } from '../../src/exporters/vector';
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

describe('advanced exporters', () => {
  const baseIndex: IndexResult = {
    spec: { type: 'filesystem', path: '/tmp/repo' },
    ref: 'base',
    files: [
      { path: 'a.txt', size: 1, hash: 'hash-a', executable: false },
    ],
    chunks: [
      {
        id: 'chunk-a',
        text: 'hello',
        fileHash: 'hash-a',
        metadata: {
          origin: 'file',
          path: 'a.txt',
          startLine: 1,
          endLine: 1,
          tokenCount: 5,
          charCount: 5,
          chunkIndex: 0,
          totalChunks: 1,
        },
      },
    ],
    createdAt: new Date().toISOString(),
    fileLanguageByHash: { 'hash-a': 'text' },
    fileContents: { 'a.txt': 'hello' },
    secretFindings: [],
    domainFindings: [],
  };

  const headIndex: IndexResult = {
    ...baseIndex,
    ref: 'head',
    files: [
      { path: 'a.txt', size: 1, hash: 'hash-a2', executable: false },
      { path: 'b.txt', size: 1, hash: 'hash-b', executable: false },
    ],
    chunks: [
      ...baseIndex.chunks,
      {
        id: 'chunk-b',
        text: 'world',
        fileHash: 'hash-b',
        metadata: {
          origin: 'file',
          path: 'b.txt',
          startLine: 1,
          endLine: 1,
          tokenCount: 5,
          charCount: 5,
          chunkIndex: 0,
          totalChunks: 1,
        },
      },
    ],
    fileLanguageByHash: { 'hash-a2': 'text', 'hash-b': 'text' },
    fileContents: { 'a.txt': 'hello!', 'b.txt': 'world' },
  };

  it('buildParquetBuffer emits binary payload', async () => {
    const buffer = await buildParquetBuffer(headIndex);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it('buildDeltaSnapshot detects added and removed chunks', () => {
    const delta = buildDeltaSnapshot(baseIndex, headIndex);
    expect(delta.addedChunks).toContain('chunk-b');
    expect(delta.changedFiles).toContain('a.txt');
  });

  it('buildVectorRecords creates embeddings of expected dimension', () => {
    const vectors = buildVectorRecords(headIndex, 16);
    expect(vectors.length).toBe(headIndex.chunks.length);
    expect(vectors[0]?.vector.length).toBe(16);
  });
});
