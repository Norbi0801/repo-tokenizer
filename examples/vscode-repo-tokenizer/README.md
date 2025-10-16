# Repo Tokenizer VS Code Helper

This sample extension exposes a single command `Repo Tokenizer: Index Workspace` which opens a terminal and runs:

```
repo-tokenizer-mcp index --config <selected-config> --quality-report <config>.report.json
```

## Usage

1. Copy this folder into your `.vscode/extensions` development directory or open it with VS Code and press `F5` to launch an extension host.
2. Run the `Repo Tokenizer: Index Workspace` command from the command palette.
3. Select a repo-tokenizer configuration file when prompted.
4. The extension creates a terminal named `Repo Tokenizer` and streams CLI output/quality report generation.

Customise the command within `extension.js` to pass additional flags (e.g. `--dry-run`, `--metrics-json`).
