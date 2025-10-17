# repo-tokenizer rollout plan

# Stage 0

## Phase 0 - Project preparation
- [x] Approve the feature scope and delivery priorities based on `features.md`.
- [x] Define the high level architecture (ingest pipeline -> chunking -> storage -> API) together with a flow diagram.
- [x] Choose the technology stack (language, frameworks, storage) and create the repository with the base directory structure.
- [x] Configure automation: CI with lint/test, basic security rules, PR/issue templates.

## Phase 1 - Repository handling
- [x] Implement Git repository ingestion (local and remote) with branch/commit/tag awareness.
- [x] Respect `.gitignore`, `global .gitignore`, and `.git/info/exclude` plus allow extra glob/regex patterns.
- [x] Detect monorepos and support scoping by workspace (npm/yarn/go) as well as paths/packages.
- [x] Support read only snapshots and operation on archives (`.tar`, `.zip`) and plain directories.
- [x] Implement sparse checkout/sparse index mode for very large repositories.
- [x] Allow pinning to a commit or merge base and produce deterministic snapshots (hash plus metadata).

## Phase 2 - Tokenisation and chunking
- [x] Design the tokenizer plugin interface and implement adapters (for example tiktoken, sentencepiece).
- [x] Deliver core chunking modes: fixed size (lines, tokens), sliding window, and by file section.
- [x] Add adaptive chunking (merging small files, splitting large files) and configurable overlaps.
- [x] Implement a context budget with automatic chunk sizing relative to token limits.
- [x] Generate stable chunk identifiers (content hash plus path) with deterministic sorting.
- [x] Prepare comparative chunking tests (different languages, small/large files).

## Phase 3 - Content normalisation and filtering
- [x] Detect and skip binary or oversized files based on size, extension, and MIME heuristics.
- [x] Auto detect generated artefacts (`dist`, `build`, `.min.js`, `vendor`) and common noise (licence boilerplate).
- [x] Normalise end of line characters, remove BOM, and trim trailing whitespace per configuration.
- [x] Implement content deduplication (hash) and sanitisation rules (secrets, banned tokens, generated comments).
- [x] Document filtering mechanics and expose a way to test patterns (for example dry run mode).

## Phase 4 - API, export, and CLI
- [x] Implement the MCP server with tools `list_files`, `get_file`, `list_chunks`, `get_chunk`, `search_text`, `search_symbols`.
- [x] Provide JSONL and SQLite export formats with result streaming and back pressure control.
- [x] Prepare reference SDKs/clients (Node.js/Python) and generate the OpenAPI spec.
- [x] Add webhook/queue delivery (SQS/NATS) for asynchronous exports.
- [x] Ship the CLI (`init`, `index`, `serve`, `export`) with YAML/TOML configuration, profiles, and shell completion.
- [x] Document the API, CLI, and example integration flows.

## Phase 5 - Incremental updates and security
- [x] Implement diff analysis (git diff versus last snapshot) and tokenisation cache keyed by content hash.
- [x] Add watch mode (fsnotify/inotify) and scheduled reindexing (cron/CI).
- [x] Provide secret masking, integration with external scanners, and redaction for logs/exports.
- [x] Ensure export encryption (AES/GPG) plus hash signatures (SHA-256) for integrity verification.
- [x] Confirm air gap compliance (no telemetry, no network dependencies in offline mode).

## Phase 6 - Integrations, performance, and observability
- [x] Support Git submodules, Git LFS, and worktrees in the ingest pipeline.
- [x] Deliver GitHub/GitLab integrations (PR diff indexing, summaries, status checks).
- [x] Prepare hooks (pre-commit, CI "index repo" job) and metrics export for pipelines.
- [x] Implement parallel processing, IO back pressure, index sharding, and resume mechanisms.
- [x] Provide Prometheus/OTel metrics, Grafana/Datadog dashboards, and readiness/liveness health checks.
- [x] Integrate CPU/heap profilers and tracing for long running jobs.

## Phase 7 - Developer experience and interfaces
- [x] Offer verbose logging (levels), dry run mode, and chunk quality/diff reports.
- [x] Prepare sample repositories (JS/TS, Python, Java, Go, Rust) and a dataset generator.
- [x] Create a TUI/HTML report (sizes, language mix, heaviest files) and IDE plugins (VS Code/JetBrains).
- [x] Build web self service integration and MCP tools (`diff_chunks`, `blame`, `resolve_ref`, `context_pack`).
- [x] Document best practices and ship tutorials/developer guides.

## Phase 8 - Domain rules, formats, and future work
- [x] Implement licence based filtering, PII anonymisation, and regulatory rule sets (SOX/GDPR).
- [x] Add Parquet export, delta snapshots, and MLOps manifests plus adapters for FAISS/Qdrant/pgvector.
- [x] Design and implement the context recommendation system and language specific chunking profiles.
- [x] Build test to source file mapping and the symbol index/dependency graph.
- [x] Prepare the roadmap for embeddings, hybrid search, and quality alerts.

## Phase 9 - Dependency modernisation
- [ ] Replace `glob@7.x` with version `^9` (or a compatible alternative) and verify the impact on code.
- [ ] Remove `inflight@1.0.6`, migrating to the recommended approach (`lru-cache` or native promise caching).
- [ ] Upgrade `rimraf` to `^4` and update build/cleanup scripts.
- [ ] Replace `@humanwhocodes/config-array` and `@humanwhocodes/object-schema` with the new `@eslint/*` packages.
- [ ] Update `eslint` to a supported release aligned with the ESLint support policy.

## Phase 10 - Stability and documentation
- [ ] Fix `README.md` (remove NUL characters, restore baseline project documentation).
- [ ] Align shared types (for example `IndexOptions` vs `IndexingConfig`) and ensure `npm run build/test` pass in strict mode.
- [ ] Add an efficient file system diff for repositories (mtime/hash cache) and cover watch/incremental scenarios with tests.
- [ ] Provide fallback detection for `tar`/`unzip` in `openArchive` plus tests for missing tooling.
- [ ] Review build configuration (`tsconfig.rootDir`) and decide whether to publish `dist/` to VCS.

## Phase 11 - MCP server channel rollout
- [x] Skatalogować operacje dostępne w obecnym REST (`GET/POST/...`), wymagane dane wejścia/wyjścia i konteksty użytkownika; nadać priorytety funkcjom, które przechodzą do kanału MCP w pierwszej kolejności. (docs/mcp/channel-rollout.md#L5)
- [x] Zdefiniować manifest MCP: nazwa, capabilities (narzędzia, eventy, kanały), wymagane role oraz format komunikatów; wskazać akcje synchroniczne vs strumienie zdarzeń. (docs/mcp/channel-rollout.md#L27)
- [x] Zaprojektować warstwę adaptera tłumaczącą wywołania MCP na serwisy domenowe zamiast delegować bezpośrednio do kontrolerów REST (warstwa współdzielona). (docs/mcp/channel-rollout.md#L67)
- [x] Ustalić strategię autoryzacji i identyfikacji klientów MCP (tokeny serwisowe, integracja z OAuth), razem z wymaganiami bezpieczeństwa (rate limiting, audyt). (docs/mcp/channel-rollout.md#L76)
- [x] Przygotować szkic kontraktów (OpenAPI → JSON Schema → definicje narzędzi MCP) i ustalić zasady wersjonowania oraz kompatybilności. (docs/mcp/channel-rollout.md#L84)
- [x] Zaplanować sekcję testów: walidacja kontraktów, scenariusze e2e z klientem MCP, testy obciążeniowe krytycznych komend oraz narzędzia do automatyzacji. (docs/mcp/channel-rollout.md#L93)
- [x] Opracować harmonogram wdrożenia: MVP (kluczowe akcje), beta (feedback partnerów), GA (pełne pokrycie REST + monitoring i alerty). (docs/mcp/channel-rollout.md#L101)
- [x] Utworzyć tabelę „REST → MCP capability” jako artefakt śledzący migrację i postęp prac. (docs/mcp/channel-rollout.md#L5)
- [x] Przeprowadzić warsztat z zespołem bezpieczeństwa w celu zatwierdzenia modelu autoryzacji MCP i wymagań audytowych. (docs/mcp/channel-rollout.md#L109)
