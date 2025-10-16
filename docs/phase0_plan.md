# Phase 0 - Project preparation

## Scope and priorities
The priorities below come from the current feature list in `features.md`. They are grouped into three levels to sequence the roadmap.

### Priority P0 - launch the indexing MVP
- Git repository handling (local/remote), read only snapshots, respect for `.gitignore`.
- Core chunking modes (lines, tokens, sliding window) and stable chunk identifiers.
- Filtering binaries and generated files, content deduplication.
- JSONL export and MCP API `list_files`, `list_chunks`, `get_chunk`, `search_text`.
- CLI configuration (`init`, `index`, `serve`) backed by a config file.
- Secret masking and air gapped mode.

### Priority P1 - strengthen developer experience and performance
- Adaptive chunking, context budgets, tokenisation cache, and watch mode.
- VCS/CI integrations (PR diff, hooks), monorepo and archive support.
- Incremental diff modes, webhook/queue exports, SDKs (Node.js/Python).
- Multi level logging, dry run, curated sample repositories.
- Extended filtering (EOL normalisation, sanitisation, log redaction).

### Priority P2 - advanced analytics
- Vector store integrations, hybrid search, embeddings.
- Symbol index, dependency graph, mapping tests to source.
- TUI/HTML reports, IDE/browser plugins, context recommendations.
- Domain policies (licences, PII, industry), Parquet export, delta snapshots.
- Production observability (Prometheus/OTel, dashboards, alerts).

Agreement: treat P0 and P1 as the core launch, with P2 following once the first feedback loop is in place.

## High level architecture
The pipeline is split into four layers. The diagram below shows the data flow and responsibilities.

```
+----------+   fetch   +-------------+  normalize  +------------+  index/store  +---------------+
| Ingestor | ------->  | Repo Cache  | ----------> | Chunker    | ------------> | Storage Layer |
+----------+           | (snapshot)  |             | + Filters  |               | (JSONL/DB)    |
      |                +-------------+             +------------+               +-------+-------+
      |                                                                              |
      |   diff/watch                                                                  | serve/export
      |                                                                              v
      +---------------------------------> Orchestrator/Queue -----------------> API (MCP/CLI)
```

### Layers and responsibilities
- **Ingestor** - clones or fetches repositories, manages sparse mode and archives, calculates diffs against the cache.
- **Repo Cache** - stores repository snapshots (content addressed) and metadata (commit, hash, paths).
- **Chunker + Filters** - performs tokenisation, chunking, normalisation, deduplication, and sanitisation.
- **Storage Layer** - persists chunks in JSONL, SQLite, or vector adapters and maintains metadata indexes.
- **Orchestrator/Queue** - coordinates jobs (full index, incremental diff, watch) and dispatches them to workers.
- **API (MCP/CLI)** - exposes MCP tools, exports, streaming endpoints, and webhook/queue integrations.

### Data flow
1. The scheduler or CLI triggers an indexing job (full/diff/watch).
2. The ingestor updates the repo cache and produces the list of changed files.
3. The chunker processes files according to configuration (tokenizer, strategies, overlap).
4. Filters perform sanitisation, deduplication, and create stable identifiers.
5. Storage writes the result to the target format and emits an event that the index is available.
6. API and CLI serve list/search queries and exports using the same metadata.

## Technology stack and repository structure
### Execution stack
- **Primary language:** TypeScript (Node.js 20 LTS) for fast iteration and rich ecosystem support (CLI, MCP, integrations).
- **Performance layer:** Rust (optional component) via N-API for heavy tokenisation and parallel IO.
- **Data storage/metadata:** SQLite for embedded mode, JSONL/Parquet for exports, adapters for FAISS/Qdrant/pgvector.
- **Queues/communication:** BullMQ (Redis) for multi worker mode; NATS as an alternative in distributed setups.
- **Configuration:** YAML/TOML files loaded through `@iarna/toml` and `js-yaml`.
- **Tests:** Vitest (unit), Jest snapshots for chunks, Playwright for CLI/API end to end tests.

### Directory structure (created)
```
repo-tokenizer/
├─ src/
│  ├─ ingest/
│  ├─ chunker/
│  ├─ storage/
│  ├─ api/
│  ├─ cli/
│  └─ common/
├─ tests/
│  ├─ unit/
│  └─ integration/
├─ config/          # sample configurations (yaml/toml)
├─ scripts/         # developer tooling, migrations, bootstrap scripts
├─ docs/            # documentation (for example phase0_plan.md)
├─ examples/        # sample repositories and demo configurations
├─ data/            # local caches and logs (ignored in git)
└─ features.md
```

Later phases add `package.json`, TypeScript configuration, CI pipelines, and so on (once Phase 0 wraps up).

## Automation (CI, security, templates)
- **GitHub Actions CI** (`.github/workflows/ci.yml`): lint (`npm lint`), unit and integration tests, security job (gitleaks, `npm audit`, `cargo audit`).
- **Security policies** (`config/policies/gitleaks.toml`): central patterns to prevent leaks, extensible with a baseline.
- **PR/issue templates:** `pull_request_template.md` with a checklist plus `ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`.
- **Automation foundations:** the `scripts/` directory for developer utilities, `config/` for lint/tokenisation settings, and a plan to add pre-commit hooks in Phase 5.
