#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createWriteStream } from 'node:fs';
import { RepoTokenizerConfig, loadConfig } from '../config';
import { IndexManager } from '../indexer';
import { exportIndexToJsonl } from '../exporters/jsonl';
import { exportIndexToSqlite } from '../exporters/sqlite';
import { createServer } from '../api/server';

function buildSampleConfig(): string {
  return `repository:
  type: filesystem
  path: ./
indexing:
  tokenizerId: basic
  chunking:
    strategy: lines
export:
  format: jsonl
  output: ./index.jsonl
server:
  port: 4000
  webhookUrl: null
  queueName: null
`;
}

async function ensureDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function loadConfigOrExit(path: string, profile?: string): Promise<RepoTokenizerConfig> {
  try {
    return await loadConfig(path, profile);
  } catch (error) {
    console.error(`Failed to load config: ${(error as Error).message}`);
    process.exit(1);
  }
}

export async function runCli(argv = process.argv) {
  const program = new Command();
  program.name('repo-tokenizer-mcp').description('Repository tokenizer CLI');

  program
    .command('init')
    .description('Create sample configuration file')
    .option('--config <path>', 'Config path', '.repo-tokenizer.yaml')
    .action(async (options) => {
      const target = resolve(options.config);
      await ensureDir(target);
      await writeFile(target, buildSampleConfig(), { flag: 'wx' }).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          console.error(`Config file already exists at ${target}`);
          process.exit(1);
        }
        throw error;
      });
      console.log(`Created config at ${target}`);
    });

  program
    .command('index')
    .description('Index repository defined in config')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--ref <ref>', 'Git reference override')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const result = await manager.indexRepository(config.repository, {
        ...config.indexing,
        ref: options.ref ?? config.indexing?.ref,
        tokenizerId: config.indexing?.tokenizerId,
      });
      console.log(`Indexed ${result.files.length} files, ${result.chunks.length} chunks (ref=${result.ref ?? 'HEAD'})`);
    });

  program
    .command('export')
    .description('Export index to JSONL or SQLite')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--format <format>', 'Export format (jsonl|sqlite)', 'jsonl')
    .option('--output <path>', 'Output file (use - for stdout)')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const result = await manager.indexRepository(config.repository, config.indexing);
      const format = options.format ?? config.export?.format ?? 'jsonl';

      if (format === 'jsonl') {
        const output = options.output ?? config.export?.output ?? 'index.jsonl';
        if (output === '-') {
          await exportIndexToJsonl(result, process.stdout);
        } else {
          const target = resolve(output);
          await ensureDir(target);
          const stream = createWriteStream(target, { encoding: 'utf8' });
          await exportIndexToJsonl(result, stream);
          stream.end();
          console.log(`Exported JSONL to ${target}`);
        }
      } else {
        const output = options.output ?? config.export?.output ?? 'index.sqlite';
        const target = resolve(output);
        await ensureDir(target);
        await exportIndexToSqlite(result, target);
        console.log(`Exported SQLite to ${target}`);
      }
    });

  program
    .command('serve')
    .description('Start MCP server')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--port <number>', 'Port override')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      if (config.indexing) {
        await manager.indexRepository(config.repository, config.indexing);
      }
      const port = options.port ? Number(options.port) : config.server?.port ?? 4000;
      const host = config.server?.host ?? '0.0.0.0';
      const server = createServer(manager, {
        spec: config.repository,
        indexOptions: config.indexing,
        notifier: {
          webhookUrl: config.server?.webhookUrl,
          queueName: config.server?.queueName,
        },
      });
      await server.listen({ port, host });
      console.log(`Server listening on http://${host}:${port}`);
    });

  program
    .command('completion')
    .description('Print shell completion script (bash)')
    .action(() => {
      const script = `#!/bin/bash
_repo_tokenizer_mcp_completions() {
  COMPREPLY=( $(compgen -W "init index export serve completion" -- "${COMP_WORDS[COMP_CWORD]}") )
}
complete -F _repo_tokenizer_mcp_completions repo-tokenizer-mcp
`;
      process.stdout.write(script);
    });

  await program.parseAsync(argv);
}

if (require.main === module) {
  runCli();
}
