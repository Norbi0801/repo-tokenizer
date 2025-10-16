# CLI Usage

`repo-tokenizer-mcp` exposes the following commands:

- `init` - creates a sample configuration file (`.repo-tokenizer.yaml`).
- `index --config <path>` - indexes a repository and prints the number of files/chunks.
- `export --config <path> [--format jsonl|sqlite] [--output <path>] [--encrypt <password>]` - exports the index to JSONL (default) or SQLite; optional AES-256-GCM encryption.
- `serve --config <path> [--port <port>]` - starts the MCP server with a REST API.
- `completion` - prints a basic bash completion script.
- `index --watch` - keeps indexing up to date by reacting to repository changes.
- `index --interval <seconds>` - triggers periodic re-indexing.
- `index --skip-secret-scan` - skips secret detection (enabled by default).
- `index --secrets-report <file>` - writes a JSON report of detected secrets.

Configuration supports profiles (`profiles:`) and the sections `repository`, `indexing`, `export`, and `server` (see `init`).

## JSONL streaming
Running `export` with `--output -` writes JSONL to STDOUT. The HTTP server exposes `/chunks?stream=true` as well as `/export/jsonl` (NDJSON) for streaming consumption.

## Webhook and queue
Inside the `server` section you can set `webhookUrl` and `queueName`. When indexing finishes the server sends a POST request to the webhook and logs the payload that can later be forwarded to SQS or NATS.

## MCP endpoints
- `GET /files`, `GET /file?path=...`
- `GET /chunks`, `GET /chunks/:id`, `GET /chunks?stream=true`
- `GET /search` (full text) and `GET /search/symbols`
- `GET /export/jsonl`, `GET /export/sqlite`

## Air gapped mode
Setting `server.airGap: true` disables webhook and queue delivery so the server avoids outbound network calls.
