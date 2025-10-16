import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface IndexRunMetrics {
  timestamp: string;
  ref: string;
  files: number;
  chunks: number;
  secrets: number;
  durationMs: number;
  incremental: boolean;
  repositoryType: string;
}

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const indexCounter = new Counter({
  name: 'repo_tokenizer_index_runs_total',
  help: 'Number of completed indexing runs',
  labelNames: ['incremental', 'repository_type'],
  registers: [registry],
});

const indexDuration = new Histogram({
  name: 'repo_tokenizer_index_duration_seconds',
  help: 'Duration of indexing runs in seconds',
  labelNames: ['incremental', 'repository_type'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [registry],
});

const filesGauge = new Gauge({
  name: 'repo_tokenizer_last_index_files',
  help: 'Number of files processed in the last indexing run',
  labelNames: ['repository_type'],
  registers: [registry],
});

const chunksGauge = new Gauge({
  name: 'repo_tokenizer_last_index_chunks',
  help: 'Number of chunks produced in the last indexing run',
  labelNames: ['repository_type'],
  registers: [registry],
});

const secretsGauge = new Gauge({
  name: 'repo_tokenizer_last_index_secrets',
  help: 'Number of secret findings detected in the last indexing run',
  labelNames: ['repository_type'],
  registers: [registry],
});

const timestampGauge = new Gauge({
  name: 'repo_tokenizer_last_index_timestamp_seconds',
  help: 'Unix timestamp (seconds) of the last completed indexing run',
  registers: [registry],
});

export function recordIndexMetrics(metrics: IndexRunMetrics): void {
  const labels = {
    incremental: metrics.incremental ? 'true' : 'false',
    repository_type: metrics.repositoryType,
  };
  indexCounter.inc(labels);
  indexDuration.observe(labels, metrics.durationMs / 1000);
  filesGauge.labels(metrics.repositoryType).set(metrics.files);
  chunksGauge.labels(metrics.repositoryType).set(metrics.chunks);
  secretsGauge.labels(metrics.repositoryType).set(metrics.secrets);
  timestampGauge.set(Date.now() / 1000);
}

export function metricsContentType(): string {
  return registry.contentType;
}

export async function getMetricsSnapshot(): Promise<string> {
  return registry.metrics();
}
