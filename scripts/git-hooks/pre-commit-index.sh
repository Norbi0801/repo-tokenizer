#!/usr/bin/env bash
set -euo pipefail

if ! command -v repo-tokenizer-mcp >/dev/null 2>&1; then
  echo "[repo-tokenizer] CLI not found; skipping indexing hook." >&2
  exit 0
fi

CONFIG_PATH="${REPO_TOKENIZER_CONFIG:-.repo-tokenizer.yaml}"
PROFILE="${REPO_TOKENIZER_PROFILE:-}"
METRICS_FILE="${REPO_TOKENIZER_METRICS_FILE:-tmp-tests/repo-tokenizer-metrics.json}"

ARGS=(index --config "$CONFIG_PATH" --metrics-json "$METRICS_FILE" --metrics-stdout)
if [[ -n "$PROFILE" ]]; then
  ARGS+=(--profile "$PROFILE")
fi

mapfile -t STAGED < <(git diff --cached --name-only --diff-filter=ACMR)
if ((${#STAGED[@]} > 0)); then
  ARGS+=(--include)
  for path in "${STAGED[@]}"; do
    ARGS+=("$path")
  done
fi

echo "[repo-tokenizer] indexing staged content..."
repo-tokenizer-mcp "${ARGS[@]}"
