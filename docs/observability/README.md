# Observability Toolkit

Repo Tokenizer exposes first-class observability primitives:

- **Prometheus metrics** (`/metrics`) – counters, gauges and histograms describing indexing throughput, latency and findings.
- **OpenTelemetry spans** – all CLI and server initiated indexing runs emit spans (`repo-tokenizer.index.*`). Attach your own OTLP exporter to ship them to Grafana, Tempo, Datadog, etc.
- **Health probes** – `/live` and `/ready` endpoints complement the existing `/health` check for Kubernetes-style deploys.
- **Profiling utilities** – capture CPU profiles and heap snapshots via CLI options or the new `/profiling/*` API routes.
- **HTML dashboard** – browse the latest quality snapshot at `/dashboard`, rendered from the same data used by the CLI report command.

## Metrics reference

Metric | Type | Labels | Description
---|---|---|---
`repo_tokenizer_index_runs_total` | Counter | `incremental`, `repository_type` | Total completed indexing runs.
`repo_tokenizer_index_duration_seconds` | Histogram | `incremental`, `repository_type` | Duration distribution for indexing runs.
`repo_tokenizer_last_index_files` | Gauge | `repository_type` | Files processed in the last run.
`repo_tokenizer_last_index_chunks` | Gauge | `repository_type` | Chunks produced in the last run.
`repo_tokenizer_last_index_secrets` | Gauge | `repository_type` | Secrets detected in the last run.
`repo_tokenizer_last_index_timestamp_seconds` | Gauge | – | Unix timestamp of last completed run.

Enable scraping in Prometheus by pointing the job to `http://<host>:<port>/metrics`. Example scrape configuration:

```yaml
- job_name: repo-tokenizer
  static_configs:
    - targets: ['repo-tokenizer:4000']
```

## Dashboards

Sample Grafana and Datadog dashboards are available under `docs/observability/dashboards/`. Import them as starting points and customise the Prometheus datasource name to match your environment.

## Tracing

Spans are produced through `@opentelemetry/api`. To export them, initialise a tracer SDK in your host application, for example:

```ts
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();
```

Indexing operations use span names `repo-tokenizer.index.cli`, `repo-tokenizer.index.server`, `repo-tokenizer.index.pull-request.*`, and `repo-tokenizer.index.bootstrap`.

## Profiling

### CLI

- `--cpu-profile <path>` – capture a CPU profile for the indexing run (`.cpuprofile` file consumable by Chrome DevTools).
- `--heap-snapshot <path>` – capture a V8 heap snapshot after the run.

Both flags work together and operate on the first run when watch/interval modes are enabled.

### HTTP API

- `POST /profiling/cpu` (optional `durationMs`, default 5000) – returns a base64 encoded `.cpuprofile` document.
- `POST /profiling/heap` – returns a base64 encoded heap snapshot.

These endpoints are safe for ad-hoc diagnostics and integrate with CI jobs for offline analysis.
