# Filtering and normalisation dry run

To validate filtering or normalisation rules for a specific file without mutating the repository, use the `scripts/dry-run-filter.ts` helper.

## Prerequisites
- `npm install`
- Node.js 20 or newer

## Running
```bash
npm ts-node scripts/dry-run-filter.ts <path-to-file>
```

The script prints:
- the `FileDetector` result (binary, oversized, generated flags),
- normalisation stats (BOM removal, EOL changes, trimmed trailing whitespace),
- a list of sanitisation rules that matched,
- potential secret scanner hits,
- deduplication outcome (hash and duplicate flag).

This makes it easy to tune `.gitignore` patterns, sanitisation rules, or file size thresholds without executing the full pipeline.
