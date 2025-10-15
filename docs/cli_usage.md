# CLI Usage

`repo-tokenizer-mcp` exposes the following commands:

- `init` – tworzy przykładowy plik konfiguracji (`.repo-tokenizer.yaml`).
- `index --config <path>` – indeksuje repozytorium i wypisuje liczbę plików/chunków.
- `export --config <path> [--format jsonl|sqlite] [--output <path>] [--encrypt <hasło>]` – eksportuje indeks do JSONL (domyślnie) lub SQLite; opcjonalnie szyfruje AES-256-GCM.
- `serve --config <path> [--port <port>]` – uruchamia MCP server z REST API.
- `completion` – wypisuje prosty skrypt autouzupełniania bash.
- `index --watch` – utrzymuje indeksację na żywo, reagując na zmiany w repozytorium.
- `index --interval <sekundy>` – uruchamia reindeksację cyklicznie.
- `index --skip-secret-scan` – pomija wykrywanie sekretów (domyślnie aktywne).
- `index --secrets-report <plik>` – zapisuje raport wykrytych sekretów w JSON.

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

### Tryb air-gap
Ustawienie `server.airGap: true` wyłącza webhook/queue, dzięki czemu serwer nie wykonuje połączeń sieciowych.
