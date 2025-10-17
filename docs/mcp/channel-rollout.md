# MCP Server Channel Rollout

## REST → MCP capability matrix

| REST endpoint | Method | Description | Request payload / query | Response payload | Proposed MCP capability | Priority | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/health`, `/live` | GET | Liveness probes | none | `{ status }` | `get_health` (combined) | GA | Keep HTTP for infra probes; surface aggregated status via MCP notifications. |
| `/ready` | GET | Readiness probe with bootstrap | none | `{ status }` | `get_health` | GA | MCP client receives readiness events when bootstrap completes. |
| `/metrics` | GET | Prometheus metrics snapshot | none | text/metrics | _Out of scope_ | — | Continue exposing via HTTP for Prometheus scrape. |
| `/dashboard` | GET | HTML quality dashboard | none | HTML | `fetch_report` (stream) | Beta | Provide HTML/JSON render over MCP file stream. |
| `/profiling/cpu` | POST | Capture CPU profile | `{ durationMs }` | Base64 profile | `capture_cpu_profile` | GA | Restricted to `maintainer` role. |
| `/profiling/heap` | POST | Heap snapshot | none | Base64 snapshot | `capture_heap_snapshot` | GA | Restrict to admins; large payloads require chunked transfers. |
| `/index` | POST | Repository indexing run | `{ ref, incremental }` | run metrics | `index_repository` (async) | MVP | Invoke via MCP tool; progress delivered as events. |
| `/pull-request` | POST | PR indexing + workflow | PR identifiers and flags | status summary | `index_pull_request` (async) | Beta | Requires Git provider secrets; MCP tool gated behind maintainer role. |
| `/files` | GET | List indexed files | `include`, `exclude`, `ref` | `{ files }` | `list_files` | MVP | Streamed responses for large sets. |
| `/file` | GET | Fetch single file | `path`, `ref` | `{ file }` | `get_file` | MVP | Return content + metadata via MCP `resource`. |
| `/chunks` | GET | List chunks | `path`, `lang`, `maxTokens`, `ref`, `stream` | `{ chunks }` or NDJSON | `list_chunks` | MVP | Support chunked streaming via MCP multi-part responses. |
| `/chunks/:id` | GET | Fetch specific chunk | `ref` | `{ chunk }` | `get_chunk` | MVP | Deterministic chunk IDs already stable. |
| `/search` | GET | Full-text search | `q`, `pathGlob`, `ref` | `{ matches }` | `search_text` | MVP | Provide pagination + snippet metadata. |
| `/search/symbols` | GET | Symbol search | `q`, `ref` | `{ matches }` | `search_symbols` | MVP | Align response with MCP `SymbolMatch` schema. |
| `/recommendations` | GET | Context recommendations | `limit`, `maxTokens`, `ref` | `{ recommendations }` | `recommend_context` | Beta | Pair with MCP sidebar suggestions. |
| `/tests/map` | GET | Test ↔ source map | `ref` | `{ tests }` | `map_tests` | Beta | Useful for IDE integrations. |
| `/graph/dependencies` | GET | Dependency graph | `ref` | `{ graph }` | `get_dependency_graph` | Beta | Consider chunk streaming for large graphs. |
| `/symbols` | GET | Indexed symbol map | `ref` | `{ symbols }` | `get_symbol_index` | Beta | Large payloads; consider server-side filtering. |
| `/export/jsonl` | GET | JSONL export | `ref` | streamed NDJSON | `export_jsonl` (async stream) | GA | Use MCP `resource` streaming channel. |
| `/export/sqlite` | GET | SQLite export | `ref` | binary buffer | `export_sqlite` (async stream) | GA | Large payload; gated by maintainer role. |
| `/mcp/diff-chunks` | POST | Diff chunks between refs | `{ baseRef, headRef, paths, limit }` | diff summary | `diff_chunks` | MVP | Map 1:1 to MCP tool. |
| `/mcp/blame` | POST | Git blame metadata | `{ path, ref }` | blame details | `blame_file` | MVP | Already MCP-aligned. |
| `/mcp/resolve-ref` | POST | Resolve ref to commit | `{ ref }` | `{ ref, commit }` | `resolve_ref` | MVP | Light-weight synchronous tool. |
| `/mcp/context-pack` | POST | Build curated context bundle | `{ ref, paths, limit, maxTokens }` | pack payload | `context_pack` | MVP | Supports conversation handoffs. |

## MCP manifest blueprint

```jsonc
{
  "name": "repo-tokenizer",
  "version": "1.0.0",
  "description": "Repository indexing and code context server",
  "capabilities": {
    "tools": [
      "list_files",
      "get_file",
      "list_chunks",
      "get_chunk",
      "search_text",
      "search_symbols",
      "diff_chunks",
      "blame_file",
      "resolve_ref",
      "context_pack",
      "index_repository",
      "recommend_context",
      "export_jsonl",
      "export_sqlite",
      "capture_cpu_profile",
      "capture_heap_snapshot"
    ],
    "events": [
      "indexing.progress",
      "indexing.completed",
      "indexing.failed",
      "health.ready",
      "export.completed"
    ],
    "subscriptions": [
      "telemetry.metrics",
      "alerts.security"
    ]
  },
  "transport": {
    "primary": "websocket",
    "fallback": "http2",
    "encoding": "jsonrpc",
    "compression": "zstd"
  },
  "roles": {
    "reader": ["list_files", "get_file", "list_chunks", "search_text", "search_symbols", "context_pack", "resolve_ref"],
    "maintainer": ["index_repository", "index_pull_request", "export_jsonl", "export_sqlite", "capture_cpu_profile", "capture_heap_snapshot"],
    "integrator": ["recommend_context", "diff_chunks", "blame_file", "get_dependency_graph", "map_tests"],
    "admin": ["alerts.security", "telemetry.metrics"]
  },
  "messages": {
    "syncTools": ["search_text", "resolve_ref", "get_file"],
    "asyncTools": ["index_repository", "export_jsonl", "export_sqlite"],
    "eventStreams": ["indexing.*", "health.ready", "telemetry.metrics"]
  }
}
```

**Synchronous tools** respond immediately (lookup, search, metadata). **Asynchronous tools** emit `*.progress` events with cursors and final payload handles. Event streams publish readiness, indexing milestones and telemetry deltas.

## Adapter layer design

- Introduce `src/mcp/adapter.ts` encapsulating translation between MCP `ToolInvocation` and domain services (`IndexManager`, exporters, reports).  
- Register tools within `McpToolRegistry` decoupled from Fastify handlers; both HTTP and MCP transports reuse shared resolvers.  
- Provide context objects (repository spec, auth claims, tracing) through dependency injection to avoid direct Fastify references.  
- Normalize responses into `McpResult` types (resources, streams, events) with shared serializer to ensure consistent schema.  
- Route long-running jobs through a `TaskOrchestrator` (existing job queue or new `AsyncJobService`) that publishes lifecycle events consumed by MCP channel and optional REST webhooks.  
- Logging and metrics flow through existing observability utilities with spans labeled `channel:mcp` for parity checks.

## Auth & security strategy

- **Identity:** Issue short-lived service tokens (JWT) with scopes matching MCP roles; integrate with existing OAuth client credentials for human-triggered flows.  
- **Handshake:** Require mutual TLS or signed WebSocket upgrade with token introspection before activating capabilities.  
- **Authorization:** Enforce scope-to-tool mapping in adapter; sensitive tools guard additional claims (`export:*`, `profiling:*`).  
- **Rate limiting:** Apply per-token + global rate limiters (`bucket4j` in Fastify plugin) mirrored in MCP adapter; include event budget for async streams.  
- **Audit:** Persist tool invocations, parameters hash, response status and caller ID in audit log (forward to existing logging sink).  
- **Secrets management:** Store provider credentials in vault and load per-session via signed tokens; never expose raw secrets through MCP responses.

## Contracts & compatibility

1. Export current REST OpenAPI (if missing, generate via `fastify-swagger`) to capture schemas.  
2. Normalize payloads into JSON Schema modules under `sdk/schemas/mcp/*.json` to reuse across REST/MCP.  
3. Generate TypeScript types from schemas (use `typescript-json-schema` or `zod` codegen) for compile-time safety.  
4. Define MCP tool contracts referencing the same schemas; version with semantic channel tags (`mcp:v1`, `mcp:v1beta`).  
5. Maintain compatibility layer: MCP `v1` mirrors REST responses; breaking changes gated behind `Accept-Version` header and MCP capability negotiation.  
6. Document mapping in `docs/mcp/contracts.md` including error codes and streaming semantics.

## Testing strategy

- **Contract tests:** Validate MCP tool inputs/outputs against shared JSON Schemas (run in CI).  
- **Interoperability tests:** Use reference MCP client (Node SDK) to exercise tool invocation matrix with mocked repositories.  
- **E2E flows:** Spin up full server in docker compose, execute indexing workflow via MCP (index → progress events → export).  
- **Performance tests:** Stress-test heavy tools (`list_chunks`, `export_*`) over MCP WebSocket with back-pressure metrics.  
- **Security tests:** Fuzz unauthorized requests, expired tokens, scope violations; assert audit log entries.  
- **Regression harness:** Mirror existing REST integration tests by running them through adapter via shared resolver functions.

## Rollout plan

| Milestone | Scope | Success criteria |
| --- | --- | --- |
| **MVP (Sprint 1-2)** | Deliver synchronous read tools (`list_files`, `get_file`, `list_chunks`, `search_text`, `resolve_ref`, `diff_chunks`, `context_pack`) plus `index_repository` async skeleton and readiness events. | MCP client fetches chunks for selected repo; indexing can be triggered and completion event received; audit records persisted. |
| **Beta (Sprint 3-4)** | Add PR workflows, recommendations, dependency graph/test map, exports streaming, role-based access control, telemetry events. | Partner teams run IDE integration in staging; load tests achieve parity with REST throughput; security review sign-off. |
| **GA (Sprint 5+)** | Harden performance, add profiling tools, finalize manifest versioning, document migration & fallback strategy, enable observability dashboards. | Production incidents handled via MCP; REST clients can migrate without functionality loss; metrics show <5% discrepancy vs REST. |

## Security workshop plan

- **Objective:** Validate MCP auth model, role scopes, audit coverage and incident response updates.  
- **Participants:** Platform security, DevOps, repo-tokenizer maintainers, integration partner representative.  
- **Agenda:** Present MCP architecture, review threat model, walk through token lifecycle, finalize rate limits, define incident playbooks.  
- **Outputs:** Signed-off security checklist, updated risk register entry, action items tracked in Jira.  
- **Schedule:** Target end of Sprint 1 (after prototype manifest) to unblock Beta scope.
