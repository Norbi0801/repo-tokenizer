## Repo Tokenizer Hooks and CI Recipes

This directory contains ready-to-use automation scripts that integrate the tokenizer with local workflows and CI pipelines.

### Git pre-commit hook

- Script: `scripts/git-hooks/pre-commit-index.sh`
- Purpose: re-index staged (ACMR) files before a commit, emit metrics, and persist JSON output.
- Environment variables:
  - `REPO_TOKENIZER_CONFIG` – path to `.repo-tokenizer.yaml` (defaults to project root).
  - `REPO_TOKENIZER_PROFILE` – optional config profile.
  - `REPO_TOKENIZER_METRICS_FILE` – metrics file destination (`tmp-tests/repo-tokenizer-metrics.json` by default).
- Usage:
  ```bash
  ln -sf ../../scripts/git-hooks/pre-commit-index.sh .git/hooks/pre-commit
  chmod +x .git/hooks/pre-commit
  ```

### CI job helper

- Script: `scripts/ci/index-repo.sh`
- Purpose: run indexing inside a CI job, export an artifact (JSONL by default), and expose metrics for observability.
- Environment variables:
  - `REPO_TOKENIZER_CONFIG`, `REPO_TOKENIZER_PROFILE` – mirror CLI options.
  - `REPO_TOKENIZER_METRICS_FILE` – metrics output path (useful for uploading to build systems).
  - `REPO_TOKENIZER_EXPORT` – path for exported index artefact.
  - `REPO_TOKENIZER_EXPORT_FORMAT` – optional export format (`jsonl` or `sqlite`).
  - `REPO_TOKENIZER_SKIP_EXPORT` – set to `1` to suppress export step.
- Example GitHub Actions usage:
  ```yaml
  - uses: actions/checkout@v4
  - run: scripts/ci/index-repo.sh
    env:
      REPO_TOKENIZER_CONFIG: .repo-tokenizer.yaml
      REPO_TOKENIZER_METRICS_FILE: ${{ runner.temp }}/tokenizer-metrics.json
  - name: Upload metrics
    uses: actions/upload-artifact@v3
    with:
      name: repo-tokenizer-metrics
      path: ${{ runner.temp }}/tokenizer-metrics.json
  - name: Upload index
    uses: actions/upload-artifact@v3
    with:
      name: repo-tokenizer-index
      path: tmp-tests/index.jsonl
  ```

### Metrics format

Both scripts rely on new CLI capabilities (`--metrics-stdout` and `--metrics-json`). The emitted JSON object looks like:

```json
{
  "event": "repo-tokenizer.index",
  "metrics": {
    "timestamp": "2024-04-18T12:00:00.000Z",
    "ref": "HEAD",
    "files": 42,
    "chunks": 313,
    "secrets": 0,
    "durationMs": 1842,
    "incremental": false,
    "includePaths": []
  }
}
```

Pipelines can parse these metrics to feed dashboards (e.g. GitHub annotations or Datadog custom metrics).

### Sample dataset generator

- Script: `scripts/datasets/generate-samples.ts`
- Purpose: materialise multi-language sample repositories (JS, Python, Go) for repeatable integration tests.
- Usage:

  ```bash
  npx ts-node scripts/datasets/generate-samples.ts ./data/samples
  ```

  Adjust the destination path to suit your workspace. The generator recreates the output directory on each run.
