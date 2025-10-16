# Features

## Repository support
- Git (local and remote) with full branch, commit, and tag awareness plus read only snapshot mode.
- Respect for `.gitignore`, custom exclusion patterns (glob/regex), and local exceptions (`.git/info/exclude`).
- Monorepo handling: path and package scoping, automatic workspace root detection (npm, yarn, go, etc.).
- Ability to process archived repositories (`.tar`, `.zip`) and folders without version control (fallback read only mode).
- Sparse checkout and sparse index modes to reduce IO for very large repositories.
- Pinning to a specific commit or merge base with deterministic snapshots.

## Tokenisation and chunking
- Generic parsers: split by lines, blocks, headers, and comments.
- Chunking modes: fixed size (tokens or characters), sliding window, and by file section.
- Support for multiple tokenizers (for example tiktoken, sentencepiece) through a plugin interface.
- Context budget manager: automatic chunk size selection based on a target token limit.
- Adaptive chunking: merge small files and split large files using language heuristics.
- Configurable overlap, stable chunk identifiers (content hash plus path), and deterministic ordering.

## Content normalisation and filtering
- Skip binary and very large files (size thresholds and extension rules).
- Auto detect generated assets (`dist`, `build`, `.min.js`, `vendor`).
- Content deduplication (hash) and stable chunk identifiers for reverse lookups.
- Normalise end of line characters and remove unnecessary trailing whitespace and BOM markers.
- Filter generated comments and boilerplate noise (for example licence headers).
- Configurable sanitisation rules (for example remove forbidden tokens).

## Outputs and MCP API
- MCP server tools: `list_files`, `get_file`, `list_chunks`, `get_chunk`, `search_text`, `search_symbols`.
- Export formats: JSONL (chunks plus metadata), optional SQLite and Parquet.
- Streaming chunk delivery and built in back pressure controls.
- SDK and reference clients for Node.js/Python and an OpenAPI spec for HTTP integrations.
- Webhooks and queues (SQS/NATS) for asynchronous index delivery.

## Incremental updates
- Process only changes (diff against the previous snapshot).
- Tokenisation cache per file/chunk content hash.
- Watch mode that reacts to file system updates (fsnotify/inotify).
- Reindexing schedules (cron/CI) and refresh on merge to the main branch.

## Configurability and CLI
- Commands: `repo-tokenizer-mcp init`, `index`, `serve`, `export`.
- Configuration file (YAML/TOML): include/exclude, tokenizer selection, maximum token count, chunking strategies.
- Config profiles per environment (for example local vs CI) with CLI overrides.
- `--dry-run` mode, verbose logging, and table or JSON output formats.
- Shell autocompletion (bash/zsh/fish) and CLI documentation generators.

## Security and privacy
- Secret masking (detectors for `.env` files, keys, tokens).
- Air gapped mode (no network), telemetry disabled by default.
- Redaction in logs and exports (hashing or placeholders for sensitive fragments).
- Integrations with external secret scanners (for example TruffleHog, GitGuardian) as an optional validation step.
- In flight export encryption (AES/GPG) and checksum signatures (SHA-256) for integrity verification.

## VCS and CI integrations
- Git submodules, Git LFS, worktrees.
- GitHub/GitLab integrations: PR diff indexing, contextual summaries, status checks.
- Hooks: pre-commit (secret validation), CI job "index repo".
- Pull based API for CI platforms (REST/gRPC) and metric reporting to pipelines.

## Optimisation and scale
- Parallel processing, memory limits, IO back pressure.
- Performance profiles, benchmarks on large monorepos.
- Shared cache across branches (content addressed store).
- Index sharding and cluster operation (worker pool, queues).
- Auto retry mechanisms and resume support after interruptions.

## Quality and developer experience
- Extensive logging (levels), dry run mode.
- Deterministic index builds, snapshots with metadata (commit, timestamp).
- Test suites and fixtures for common ecosystems (JS/TS, Python, Java, Go, Rust).
- Sample dataset generator for manual chunk inspection.
- Snapshot comparisons (index diffs) and chunk quality regression reports.

## Interfaces
- MCP tools: `diff_chunks`, `blame`, `resolve_ref`, `context_pack`.
- `context_pack(files|symbols, max_tokens)` - automatic chunk selection tailored to a token budget.
- Lightweight TUI and HTML report (sizes, language breakdown, heaviest files).
- Plugins for VS Code and JetBrains with chunk browsers and conversation context helpers.
- Web integration for self service repository analysis.

## Domain rules
- Licence based filtering (exclude folders with a disallowed licence).
- PII anonymisation in comments/documents (optional).
- Industry rule packs (SOX/GDPR) as predefined configuration bundles.
- Compliance reports (filter decision logs) for audit purposes.

## Data format
- Export to Parquet/SQLite for analytics.
- Compatibility adapters for common vector stores (FAISS, Qdrant, pgvector).
- Delta snapshots (only changed chunks/metadata).
- Manifest generation (JSON/YAML) for MLOps pipelines.

## Observability and operations
- Prometheus/OTel metrics (tokenisation time, throughput, cache hit rate).
- Operational dashboards (Grafana, Datadog) with alerts for quality or performance regressions.
- HTTP/gRPC health checks plus readiness and liveness endpoints.
- Built in profilers (CPU/heap) and tracing for long running tasks.

## MCP contract sketch
- `list_files({ include?: string[], exclude?: string[] }) -> { files: { path, size, lang, hash }[] }`
- `list_chunks({ path?: string, lang?: string, max_tokens?: number }) -> { chunks: { id, path, start_line, end_line, token_count, hash }[] }`
- `get_chunk({ id }) -> { text, metadata }`
- `search_text({ query, path_glob?: string }) -> { matches: { path, line, excerpt }[] }`
- `context_pack({ targets: string[] | symbol[], max_tokens }) -> { chunks: Chunk[] }`
- `diff_chunks({ base_ref, head_ref }) -> { added: Chunk[], removed: Chunk[], modified: { before: Chunk, after: Chunk }[] }`

## Default chunking strategies
- "By lines": N lines with overlap M (simple and fast).
- "By tokens": N tokens with overlap M (stable for models).
- "By syntax": section based (function/class/module) using language aware parsers.
- "Hybrid": start with syntax and trim to the token budget when necessary.
- "Semantic merge": combine related chunks on the fly for contextual queries.

## Next steps worth adding
- Deeper code analysis: semantic chunking driven by ASTs (Tree sitter) and symbols (ctags).
- Symbol index (definitions, references), package dependency graph.
- Test to source mapping (heuristics based on names/paths).
- Embedding generation (configurable models) and hybrid search (BM25 plus vector plus metadata filters).
- Review platform integration (contextual comments, author plugins) and quality change notifications.
- Intelligent chunking profiles per language and repository style (learned from historical statistics).
- Context recommendation system (suggest most relevant files or symbols for a user query).
