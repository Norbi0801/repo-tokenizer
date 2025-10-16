import { QualityReport } from './quality';

interface HtmlOptions {
  title?: string;
}

export function renderQualityReportHtml(report: QualityReport, options: HtmlOptions = {}): string {
  const title = options.title ?? 'Repo Tokenizer Quality Report';
  const totalsRows = `
    <tr><th>Files</th><td>${report.totals.files}</td></tr>
    <tr><th>Chunks</th><td>${report.totals.chunks}</td></tr>
    <tr><th>Total tokens</th><td>${report.totals.tokens}</td></tr>
    <tr><th>Average tokens</th><td>${report.totals.avgTokens}</td></tr>
    <tr><th>Min tokens</th><td>${report.totals.minTokens}</td></tr>
    <tr><th>Max tokens</th><td>${report.totals.maxTokens}</td></tr>`;

  const languages = report.languages
    .map((lang) => `<tr><td>${lang.language}</td><td>${lang.files}</td><td>${lang.chunks}</td></tr>`)
    .join('\n');

  const buckets = report.chunkDistribution
    .map((bucket) => `<tr><td>${bucket.bucket}</td><td>${bucket.count}</td></tr>`)
    .join('\n');

  const diff = report.diff
    ? `<section>
        <h2>Diff vs baseline</h2>
        <p>Added files: ${report.diff.addedFiles.join(', ') || 'none'}</p>
        <p>Removed files: ${report.diff.removedFiles.join(', ') || 'none'}</p>
        <p>Changed files: ${report.diff.changedFiles.join(', ') || 'none'}</p>
        <p>Added chunks: ${report.diff.addedChunks}</p>
        <p>Removed chunks: ${report.diff.removedChunks}</p>
      </section>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #222; }
      h1 { margin-bottom: 0.5rem; }
      table { border-collapse: collapse; margin-bottom: 1.5rem; width: 100%; max-width: 600px; }
      th, td { padding: 0.5rem; border: 1px solid #ddd; text-align: left; }
      th { background: #f5f5f5; width: 40%; }
      section { margin-bottom: 2rem; }
      .grid { display: grid; gap: 1.5rem; }
      .grid > div { border: 1px solid #eee; padding: 1rem; border-radius: 0.5rem; background: #fafafa; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <section class="grid">
      <div>
        <h2>Totals</h2>
        <table>${totalsRows}</table>
      </div>
      <div>
        <h2>Secrets</h2>
        <table>
          <tr><th>Findings</th><td>${report.secrets.findings}</td></tr>
          <tr><th>Files with secrets</th><td>${report.secrets.filesWithSecrets}</td></tr>
        </table>
      </div>
    </section>
    <section>
      <h2>Language breakdown</h2>
      <table>
        <thead><tr><th>Language</th><th>Files</th><th>Chunks</th></tr></thead>
        <tbody>${languages}</tbody>
      </table>
    </section>
    <section>
      <h2>Chunk distribution</h2>
      <table>
        <thead><tr><th>Bucket</th><th>Count</th></tr></thead>
        <tbody>${buckets}</tbody>
      </table>
    </section>
    ${diff}
  </body>
</html>`;
}
