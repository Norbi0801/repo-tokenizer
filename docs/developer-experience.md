# Developer Experience Toolkit

## Logging & Diagnostics

- Configure log level/format via CLI flags (`--log-level`, `--log-format`) or `REPO_TOKENIZER_LOG_LEVEL/FORMAT`.
- All commands pipe diagnostics through the shared logger (`src/common/logger.ts`). Use `--log-format json` for structured pipelines.
- `--dry-run` prevents cache mutation and pairs with `--quality-report` to inspect changes before persisting.

## Quality Reporting

| Command | Description |
| --- | --- |
| `repo-tokenizer-mcp index --quality-report <file>` | Generates a JSON quality snapshot during indexing. |
| `repo-tokenizer-mcp report --html report.html --tui` | Produces standalone HTML and terminal dashboards driven by `src/reports/*`. |
| `repo-tokenizer-mcp recommend --limit 5` | Emits context recommendations derived from token heuristics, secrets and domain findings. |
| `GET /dashboard` | Self-service HTML dashboard (served by the Fastify API). |

The report captures chunk/token distributions, language breakdowns, secret findings and baseline diffs. Use `--quality-report-base <ref>` (or `--baseline` for the `report` command) to compare commits.

## Dataset Generator

Generate deterministic multi-language fixtures for benchmarking:

```bash
npx ts-node scripts/datasets/generate-samples.ts ./data/samples
```

Each run produces JS, Python and Go repositories ready for integration tests or demos.

## IDE Integrations

- **VS Code:** sample extension in `examples/vscode-repo-tokenizer` registers a command that invokes the CLI inside a terminal.
- **JetBrains:** follow `docs/ide/jetbrains.md` to configure External Tools pointing at repo-tokenizer commands.

### Graph & coverage utilities

CLI commands surface structural insights:

- `repo-tokenizer-mcp tests-map` – map tests to candidate source files.
- `repo-tokenizer-mcp deps-graph` – export import-based dependency graph.
- `repo-tokenizer-mcp symbols-index` – list indexed symbols for downstream tooling.
- API counterparts: `GET /tests/map`, `GET /graph/dependencies`, `GET /symbols`.

## Web & MCP integrations

The API exposes MCP-aligned endpoints:

- `POST /mcp/diff-chunks` – returns added/removed chunks between refs.
- `POST /mcp/blame` – Git blame metadata for a path.
- `POST /mcp/resolve-ref` – resolves refs to commit hashes.
- `POST /mcp/context-pack` – builds a curated chunk bundle (mirrored by the `context-pack` CLI command).
- `POST /mcp/diff-chunks`, `POST /mcp/blame`, `POST /mcp/resolve-ref` – diff and repository introspection helpers.
- `GET /recommendations` – returns context recommendations compatible with MCP tools.

CLI counterparts `diff-chunks`, `blame`, `resolve-ref`, and `context-pack` return JSON payloads for shell pipelines.

## Observability recap

See `docs/observability/README.md` for metrics, tracing and profiling instructions. Combine with quality reports to monitor chunk health over time.
