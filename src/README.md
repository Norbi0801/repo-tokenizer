# Struktura katalogu `src`

```
src/
├─ ingest/        # moduły pobierania repozytoriów, snapshoty, diff
├─ chunker/       # tokenizacja, strategie chunkingu, normalizacja
├─ storage/       # warstwa zapisu (JSONL, SQLite, adaptery wektorowe)
├─ api/           # serwer MCP/HTTP, kontrakty, streamy
├─ cli/           # komendy repo-tokenizer-mcp (init/index/serve/export)
└─ common/        # współdzielone utilsy, kontrakty, logowanie, konfiguracja
```

Każdy moduł otrzyma dedykowany podkatalog na implementację (`*.ts`/`*.rs` zgodnie z ustalonym stackiem) oraz testy w `tests/`.
