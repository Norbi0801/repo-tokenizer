import { describe, it, expect } from 'vitest';
import { renderQualityReportHtml, renderQualityReportTui, buildQualityReport } from '../../src/reports';
import { IndexResult } from '../../src/indexer/types';
import { Writable } from 'node:stream';

const BASE_INDEX: IndexResult = {
  spec: { type: 'filesystem', path: '/tmp/test' },
  ref: 'HEAD',
  files: [{ path: 'file.txt', size: 5, hash: 'hash', language: 'text', executable: false }],
  chunks: [
    {
      id: 'c1',
      text: 'hello',
      fileHash: 'hash',
      metadata: {
        path: 'file.txt',
        startLine: 1,
        endLine: 1,
        tokenCount: 5,
        charCount: 5,
        origin: 'file',
        chunkIndex: 0,
        totalChunks: 1,
      },
    },
  ],
  createdAt: new Date().toISOString(),
  fileLanguageByHash: { hash: 'text' },
  fileContents: { 'file.txt': 'hello' },
  secretFindings: [],
};

class MemoryStream extends Writable {
  output = '';
  _write(chunk: any, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.output += chunk.toString();
    callback();
  }
}

describe('report renderers', () => {
  it('renders HTML report', () => {
    const report = buildQualityReport(BASE_INDEX);
    const html = renderQualityReportHtml(report, { title: 'Test Report' });
    expect(html).toContain('Test Report');
    expect(html).toContain('Chunk distribution');
    expect(html).toContain('Totals');
  });

  it('renders TUI report to stream', () => {
    const report = buildQualityReport(BASE_INDEX);
    const stream = new MemoryStream();
    renderQualityReportTui(report, { stream });
    expect(stream.output).toContain('Quality Report');
    expect(stream.output).toContain('Files');
  });
});
