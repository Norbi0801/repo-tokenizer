# `src` directory structure

```
src/
├─ ingest/        # repository ingestion, snapshots, diffs
├─ chunker/       # tokenisation, chunking strategies, normalisation
├─ storage/       # output layer (JSONL, SQLite, vector adapters)
├─ api/           # MCP/HTTP server, contracts, streaming
├─ cli/           # repo-tokenizer-mcp commands (init/index/serve/export)
└─ common/        # shared utilities, contracts, logging, configuration
```

Each module gets its own subdirectory for implementation (`*.ts` or `*.rs` as defined in the stack) and matching tests inside `tests/`.
