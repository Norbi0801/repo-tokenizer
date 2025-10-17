
# repo-tokenizer

The `repo-tokenizer` project provides tooling for indexing, chunking, and serving source repositories in formats that are friendly to language models and context delivery systems. It ships a command line interface, an MCP server, and SDK helpers that make AI integrations straightforward.

## Prerequisites
- Node.js version 20 or newer
- npm (installed together with Node.js)
- Access to the source repository you want to process

## Installation and setup
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the TypeScript sources into JavaScript:
   ```bash
   npm run build
   ```
3. (Optional) Link the CLI globally for local experimentation:
   ```bash
   npm link
   ```

## Configuration
1. Generate a starter configuration file:
   ```bash
   npx repo-tokenizer-mcp init
   ```
   The command creates `.repo-tokenizer.yaml` with inline comments and sample profiles.
2. Adjust the `repository`, `indexing`, `export`, and `server` sections to match your project. Details for each field live in the `docs/` directory and the generated file.
3. For CI environments, consider creating a dedicated profile (for example `profiles.ci`) that reduces disk I O and disables optional features.

### Example `.repo-tokenizer.yaml`
```yaml
profiles:
  default:
    repository:
      root: ./
      include:
        - src/**
      exclude:
        - node_modules/**
    indexing:
      tokenizer: tiktoken
      chunking:
        strategy: byTokens
        maxTokens: 800
        overlapTokens: 80
    export:
      format: jsonl
      output: data/index.jsonl
```

## CLI usage
After building the project you can run the CLI as `repo-tokenizer-mcp` (when linked) or `npx repo-tokenizer-mcp`.

- Create an index for the repository:
  ```bash
  npx repo-tokenizer-mcp index --config .repo-tokenizer.yaml
  ```
- Watch the repository for changes:
  ```bash
  npx repo-tokenizer-mcp index --config .repo-tokenizer.yaml --watch
  ```
- Export chunks to JSONL or SQLite (with optional encryption):
  ```bash
  npx repo-tokenizer-mcp export --config .repo-tokenizer.yaml --format jsonl --output data/index.jsonl
  npx repo-tokenizer-mcp export --config .repo-tokenizer.yaml --format sqlite --output data/index.sqlite --encrypt password123
  ```
- Start the MCP server:
  ```bash
  npx repo-tokenizer-mcp serve --config .repo-tokenizer.yaml --port 8080
  ```

### Key MCP endpoints
- `GET /files`, `GET /file?path=...`
- `GET /chunks`, `GET /chunks/:id`, `GET /chunks?stream=true`
- `GET /search`, `GET /search/symbols`
- `GET /export/jsonl`, `GET /export/sqlite`

## npm scripts
- `npm run build` - compiles the TypeScript project into the `dist/` directory.
- `npm run lint` - runs TypeScript in no emit mode for static analysis.
- `npm test` - executes unit tests with Vitest.
- `npm run test:integration` - placeholder for future integration tests.

## Testing
1. Make sure the project is built (`npm run build`).
2. Execute the test suite:
   ```bash
   npm test
   ```
3. Add new test cases inside the `tests/` directory using Vitest fixtures.

## Repository structure
- `src/` - CLI, MCP server, and indexing logic.
- `dist/` - build artifacts produced by TypeScript.
- `docs/` - extended documentation (CLI reference, hooks, roadmap, developer experience guides).
- `examples/` - sample configurations and demo datasets.
- `data/` - default output location for exported indexes.
- `sdk/` - client libraries and integration helpers.
- `scripts/` - automation utilities.
- `tests/` - unit tests and fixtures.

## Additional resources
- `docs/cli_usage.md` - CLI commands and flags in depth.
- `docs/hooks.md` - webhook and queue integrations.
- `docs/observability/` - metrics, tracing, and profiling instructions.
- `docs/openapi.yaml` - HTTP API specification.
- `features.md` - complete feature catalogue.

## Contributing
1. Fork the repository and create a branch (for example `feature/my-change`).
2. Implement your changes and add matching tests.
3. Ensure `npm run lint` and `npm test` both succeed.
4. Open a pull request describing the problem, the solution, and validation steps.

## License
The project is distributed under the MIT License (see `LICENSE`).

## Support
Have questions or found a bug? Open an issue in the repository or contact the maintainer team.
