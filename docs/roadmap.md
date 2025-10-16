# Repo Tokenizer Roadmap

## Near term (Phase 9 - Dependency modernisation)
- Upgrade the dependency stack (glob, rimraf, ESLint) while keeping backward compatibility.
- Replace deprecated packages (`inflight`) and adopt modern caching helpers.
- Document the compatibility matrix for Node.js and popular package managers.

## Medium term (Phase 10 - Stability and documentation)
- Restore and expand README led onboarding with architecture diagrams.
- Harden filesystem diffing and watch pipelines for large monorepos.
- Improve archive ingestion resilience with fallback tooling checks.

## Future enhancements
- Embedding pipelines with hybrid search (BM25 plus vector) and streaming adapters.
- Quality signal notifications (webhooks, Slack) when token budgets or secret findings exceed thresholds.
- Context aware summarisation (LLM assisted) built on top of the new recommendation and dependency graph APIs.
- Multi language profiling heuristics continually tuned using dataset generator benchmarks.

This roadmap builds on the Phase 8 foundation: domain policies, advanced exporters, recommendations, and developer tooling.
