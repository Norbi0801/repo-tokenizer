# CLI Usage

`repo-tokenizer-mcp` exposes the following commands:

- `init` – tworzy przykładowy plik konfiguracji (`.repo-tokenizer.yaml`).
- `index --config <path>` – indeksuje repozytorium i wypisuje liczbę plików/chunków.
- `export --config <path> [--format jsonl|sqlite] [--output <path>]` – eksportuje indeks do JSONL (domyślnie) lub SQLite.
- `serve --config <path> [--port <port>]` – uruchamia MCP server z REST API.
- `completion` – wypisuje prosty skrypt autouzupełniania bash.

Konfiguracja obsługuje profile (`profiles:`) oraz sekcje `repository`, `indexing`, `export`, `server` (patrz `init`).

### Strumieniowanie JSONL
Polecenie `export` z `--output -` pisze JSONL na STDOUT. Serwer HTTP posiada endpoint `/chunks?stream=true` oraz `/export/jsonl` (NDJSON) do strumieniowej konsumpcji.

### Webhook / kolejka
W sekcji `server` można wskazać `webhookUrl` i `queueName`. Po zakończeniu indeksacji serwer wyśle POST do webhooka oraz zaloguje payload jako stub kolejki (do podmiany na SQS/NATS).

### MCP endpoints
- `GET /files`, `GET /file?path=...`
- `GET /chunks`, `GET /chunks/:id`, `GET /chunks?stream=true`
- `GET /search` (full-text) oraz `GET /search/symbols`
- `GET /export/jsonl`, `GET /export/sqlite`
