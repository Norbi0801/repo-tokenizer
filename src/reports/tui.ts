import { Writable } from 'node:stream';
import { QualityReport } from './quality';

interface TuiOptions {
  stream?: Writable;
}

function formatRow(columns: Array<{ text: string; width: number }>): string {
  return columns.map((column) => column.text.padEnd(column.width)).join('  ');
}

export function renderQualityReportTui(report: QualityReport, options: TuiOptions = {}): void {
  const stream = options.stream ?? process.stdout;
  stream.write('\n=== Repo Tokenizer Quality Report ===\n');
  stream.write(formatRow([
    { text: 'Files', width: 10 },
    { text: 'Chunks', width: 10 },
    { text: 'Tokens', width: 12 },
    { text: 'Avg tokens', width: 12 },
  ]));
  stream.write('\n');
  stream.write(
    formatRow([
      { text: String(report.totals.files), width: 10 },
      { text: String(report.totals.chunks), width: 10 },
      { text: String(report.totals.tokens), width: 12 },
      { text: String(report.totals.avgTokens), width: 12 },
    ]) + '\n\n',
  );

  stream.write('Languages\n');
  report.languages.slice(0, 10).forEach((language) => {
    stream.write(formatRow([
      { text: `- ${language.language}`, width: 20 },
      { text: `files:${language.files}`, width: 12 },
      { text: `chunks:${language.chunks}`, width: 12 },
    ]) + '\n');
  });
  if (report.languages.length > 10) {
    stream.write(`  ... +${report.languages.length - 10} more\n`);
  }
  stream.write('\n');

  stream.write('Chunk distribution\n');
  report.chunkDistribution.forEach((bucket) => {
    stream.write(formatRow([
      { text: `- ${bucket.bucket}`, width: 12 },
      { text: String(bucket.count), width: 8 },
    ]) + '\n');
  });
  stream.write('\n');

  stream.write('Secrets\n');
  stream.write(
    `  findings: ${report.secrets.findings}\n  files: ${report.secrets.filesWithSecrets}\n\n`,
  );

  if (report.diff) {
    stream.write('Diff vs baseline\n');
    stream.write(`  added files: ${report.diff.addedFiles.join(', ') || 'none'}\n`);
    stream.write(`  removed files: ${report.diff.removedFiles.join(', ') || 'none'}\n`);
    stream.write(`  changed files: ${report.diff.changedFiles.join(', ') || 'none'}\n`);
    stream.write(`  added chunks: ${report.diff.addedChunks}\n`);
    stream.write(`  removed chunks: ${report.diff.removedChunks}\n`);
  }

  stream.write('\n');
}
