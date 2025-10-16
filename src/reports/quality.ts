import { IndexResult } from '../indexer/types';

export interface QualityReport {
  totals: {
    files: number;
    chunks: number;
    tokens: number;
    avgTokens: number;
    minTokens: number;
    maxTokens: number;
  };
  secrets: {
    findings: number;
    filesWithSecrets: number;
  };
  languages: Array<{ language: string; files: number; chunks: number }>;
  chunkDistribution: Array<{ bucket: string; count: number }>;
  diff?: {
    addedFiles: string[];
    removedFiles: string[];
    changedFiles: string[];
    addedChunks: number;
    removedChunks: number;
  };
}

const BUCKETS = [50, 100, 200, 400, 800, 1600];

function bucketLabel(value: number): string {
  for (const bucket of BUCKETS) {
    if (value <= bucket) {
      return `<=${bucket}`;
    }
  }
  return `>${BUCKETS[BUCKETS.length - 1]}`;
}

export function buildQualityReport(current: IndexResult, baseline?: IndexResult): QualityReport {
  const tokens = current.chunks.reduce((sum, chunk) => sum + (chunk.metadata.tokenCount ?? chunk.text.length), 0);
  const tokenCounts = current.chunks.map((chunk) => chunk.metadata.tokenCount ?? chunk.text.length);
  const minTokens = tokenCounts.length > 0 ? Math.min(...tokenCounts) : 0;
  const maxTokens = tokenCounts.length > 0 ? Math.max(...tokenCounts) : 0;
  const avgTokens = current.chunks.length > 0 ? Number((tokens / current.chunks.length).toFixed(2)) : 0;

  const secretsByFile = new Set(current.secretFindings.map((finding) => finding.path));
  const languageStats = new Map<string, { files: number; chunks: number }>();
  current.files.forEach((file) => {
    const language = (file.language ?? 'unknown').toLowerCase();
    const entry = languageStats.get(language) ?? { files: 0, chunks: 0 };
    entry.files += 1;
    entry.chunks += current.chunks.filter((chunk) => chunk.metadata.path === file.path).length;
    languageStats.set(language, entry);
  });

  const chunkBuckets = new Map<string, number>();
  current.chunks.forEach((chunk) => {
    const tokensCount = chunk.metadata.tokenCount ?? chunk.text.length;
    const label = bucketLabel(tokensCount);
    chunkBuckets.set(label, (chunkBuckets.get(label) ?? 0) + 1);
  });

  const report: QualityReport = {
    totals: {
      files: current.files.length,
      chunks: current.chunks.length,
      tokens,
      avgTokens,
      minTokens,
      maxTokens,
    },
    secrets: {
      findings: current.secretFindings.length,
      filesWithSecrets: secretsByFile.size,
    },
    languages: Array.from(languageStats.entries())
      .map(([language, stats]) => ({ language, files: stats.files, chunks: stats.chunks }))
      .sort((a, b) => b.files - a.files),
    chunkDistribution: Array.from(chunkBuckets.entries())
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => a.bucket.localeCompare(b.bucket)),
  };

  if (baseline) {
    const addedFiles: string[] = [];
    const removedFiles: string[] = [];
    const changedFiles: string[] = [];
    const baselineFiles = new Map(baseline.files.map((file) => [file.path, file]));
    const currentFiles = new Map(current.files.map((file) => [file.path, file]));

    current.files.forEach((file) => {
      const previous = baselineFiles.get(file.path);
      if (!previous) {
        addedFiles.push(file.path);
        return;
      }
      if (previous.hash !== file.hash) {
        changedFiles.push(file.path);
      }
    });

    baseline.files.forEach((file) => {
      if (!currentFiles.has(file.path)) {
        removedFiles.push(file.path);
      }
    });

    const baselineChunks = new Set(baseline.chunks.map((chunk) => chunk.id));
    const currentChunks = new Set(current.chunks.map((chunk) => chunk.id));
    let addedChunks = 0;
    let removedChunks = 0;
    currentChunks.forEach((id) => {
      if (!baselineChunks.has(id)) {
        addedChunks += 1;
      }
    });
    baselineChunks.forEach((id) => {
      if (!currentChunks.has(id)) {
        removedChunks += 1;
      }
    });

    report.diff = {
      addedFiles: addedFiles.sort(),
      removedFiles: removedFiles.sort(),
      changedFiles: changedFiles.sort(),
      addedChunks,
      removedChunks,
    };
  }

  return report;
}
