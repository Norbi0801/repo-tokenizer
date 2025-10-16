# JetBrains Integration (IntelliJ / WebStorm)

Use the built-in *External Tools* feature to invoke repo-tokenizer from any JetBrains IDE.

1. Open **Settings → Tools → External Tools** and click **+**.
2. Set the following fields:
   - **Name:** Repo Tokenizer Index
   - **Program:** `repo-tokenizer-mcp`
   - **Arguments:** `index --config $ProjectFileDir$/.repo-tokenizer.yaml --quality-report $ProjectFileDir$/tmp-tests/quality-report.json`
   - **Working directory:** `$ProjectFileDir$`
3. (Optional) Duplicate the tool and adjust the arguments for other commands, e.g. `report --tui` or `report --html $ProjectFileDir$/tmp-tests/report.html`.
4. Assign a shortcut under **Keymap → External Tools** for one-touch execution.

For richer integration, attach the generated HTML report (`tmp-tests/report.html`) as a browser preview tab or configure a File Watcher to rerun `repo-tokenizer-mcp report --tui` on save.
