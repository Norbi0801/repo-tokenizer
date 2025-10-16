const vscode = require('vscode');
const { join } = require('node:path');
const { existsSync } = require('node:fs');

async function pickConfig(workspaceFolder) {
  const defaultPath = join(workspaceFolder.uri.fsPath, '.repo-tokenizer.yaml');
  if (existsSync(defaultPath)) {
    return defaultPath;
  }
  const selection = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: 'Select repo-tokenizer config',
    filters: { YAML: ['yaml', 'yml'], JSON: ['json'] },
  });
  return selection?.[0]?.fsPath;
}

function activate(context) {
  const disposable = vscode.commands.registerCommand('repoTokenizer.indexWorkspace', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showErrorMessage('Open a workspace folder before running repo-tokenizer.');
      return;
    }
    const configPath = await pickConfig(folders[0]);
    if (!configPath) {
      vscode.window.showWarningMessage('No configuration selected.');
      return;
    }
    const terminal = vscode.window.createTerminal({ name: 'Repo Tokenizer' });
    terminal.show();
    terminal.sendText(`repo-tokenizer-mcp index --config "${configPath}" --quality-report "${configPath}.report.json"`);
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
