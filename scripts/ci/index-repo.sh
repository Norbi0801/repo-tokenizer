#!/usr/bin/env bash
set -euo pipefail

if ! command -v repo-tokenizer-mcp >/dev/null 2>&1; then
  echo "[repo-tokenizer] CLI not found. Install dependencies before running this job." >&2
  exit 1
fi

CONFIG_PATH="${REPO_TOKENIZER_CONFIG:-.repo-tokenizer.yaml}"
PROFILE="${REPO_TOKENIZER_PROFILE:-}"
METRICS_FILE="${REPO_TOKENIZER_METRICS_FILE:-tmp-tests/repo-tokenizer-metrics.json}"
EXPORT_PATH="${REPO_TOKENIZER_EXPORT:-tmp-tests/index.jsonl}"

ARGS=(index --config "$CONFIG_PATH" --metrics-json "$METRICS_FILE" --metrics-stdout)
if [[ -n "$PROFILE" ]]; then
  ARGS+=(--profile "$PROFILE")
fi

echo "[repo-tokenizer] indexing repository snapshot..."
repo-tokenizer-mcp "${ARGS[@]}" "$@"

if [[ "${REPO_TOKENIZER_SKIP_EXPORT:-0}" != "1" ]]; then
  EXPORT_ARGS=(export --config "$CONFIG_PATH" --output "$EXPORT_PATH")
  if [[ -n "$PROFILE" ]]; then
    EXPORT_ARGS+=(--profile "$PROFILE")
  fi
  if [[ -n "${REPO_TOKENIZER_EXPORT_FORMAT:-}" ]]; then
    EXPORT_ARGS+=(--format "$REPO_TOKENIZER_EXPORT_FORMAT")
  fi
  echo "[repo-tokenizer] exporting index to $EXPORT_PATH"
  repo-tokenizer-mcp "${EXPORT_ARGS[@]}"
fi
