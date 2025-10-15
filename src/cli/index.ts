#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createWriteStream, createReadStream } from 'node:fs';
import chokidar from 'chokidar';
import { createHash } from 'node:crypto';
import { RepoTokenizerConfig, loadConfig } from '../config';
import { IndexManager, IndexOptions } from '../indexer';
import { exportIndexToJsonl } from '../exporters/jsonl';
import { exportIndexToSqlite, buildSqliteBuffer } from '../exporters/sqlite';
import { createEncryptedFileWriter, encryptBuffer } from '../exporters/encryption';
import { createServer } from '../api/server';

function buildSampleConfig(): string {
  return `repository:
  type: filesystem
  path: ./
indexing:
  tokenizerId: basic
  chunking:
    strategy: lines
  scanSecrets: true
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

async function computeSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('close', () => resolve(hash.digest('hex')));
  });
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
    .option('--watch', 'Watch repository for changes and re-index incrementally')
    .option('--interval <seconds>', 'Re-index on a fixed cadence')
    .option('--skip-secret-scan', 'Disable in-memory secret detection')
    .option('--secrets-report <path>', 'Write secret findings to JSON file')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const watchEnabled = Boolean(options.watch);
      const intervalSec = options.interval ? Number(options.interval) : undefined;
      let lastResult: Awaited<ReturnType<typeof manager.indexRepository>> | undefined;
      let running = false;
      let pending = false;

      const runIndex = async () => {
        if (running) {
          pending = true;
          return;
        }
        running = true;
        try {
          const incrementalOptions: IndexOptions = {
            ref: options.ref ?? config.indexing?.ref,
            tokenizerId: config.indexing?.tokenizerId,
            includePaths: config.indexing?.includePaths,
            excludeGlobs: config.indexing?.excludeGlobs,
            sparsePatterns: config.indexing?.sparsePatterns,
            chunking: config.indexing?.chunking,
          };

          if (config.indexing?.scanSecrets !== undefined) {
            incrementalOptions.scanSecrets = config.indexing.scanSecrets;
          }
          if (options.skipSecretScan) {
            incrementalOptions.scanSecrets = false;
          }
          if (config.indexing?.secretPatterns) {
            incrementalOptions.secretPatterns = config.indexing.secretPatterns;
          }

          if (watchEnabled || intervalSec) {
            incrementalOptions.incremental = true;
            if (lastResult?.ref) {
              incrementalOptions.baseRef = lastResult.ref;
            } else if (config.indexing?.ref) {
              incrementalOptions.baseRef = config.indexing.ref;
            }
          }

          const result = await manager.indexRepository(config.repository, incrementalOptions);
          lastResult = result;
          console.log(
            `Indexed ${result.files.length} files, ${result.chunks.length} chunks (ref=${result.ref ?? 'HEAD'})`,
          );
          if (options.secretsReport) {
            const reportPath = resolve(options.secretsReport);
            await ensureDir(reportPath);
            await writeFile(reportPath, JSON.stringify(result.secretFindings, null, 2));
            console.log(`Secret findings written to ${reportPath}`);
          }
        } catch (error) {
          console.error(`Index failed: ${(error as Error).message}`);
        } finally {
          running = false;
          if (pending) {
            pending = false;
            runIndex();
          }
        }
      };

      await runIndex();

      let watcher: chokidar.FSWatcher | undefined;
      if (watchEnabled) {
        const paths = config.repository.path ? [config.repository.path] : [];
        if (paths.length > 0) {
          watcher = chokidar.watch(paths, {
            ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/build/**'],
            ignoreInitial: true,
          });
          const schedule = () => runIndex();
          watcher.on('add', schedule).on('change', schedule).on('unlink', schedule);
          console.log('Watching for changes...');
        } else {
          console.warn('Watch mode requires local filesystem path.');
        }
      }

      let intervalHandle: NodeJS.Timeout | undefined;
      if (intervalSec && intervalSec > 0) {
        intervalHandle = setInterval(runIndex, intervalSec * 1000);
        console.log(`Scheduled re-index every ${intervalSec} seconds.`);
      }

      if (watchEnabled || intervalHandle) {
        const shutdown = async () => {
          intervalHandle && clearInterval(intervalHandle);
          if (watcher) {
            await watcher.close();
          }
          process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        await new Promise(() => {
          /* keep process alive until signal */
        });
      }
    });

  program
    .command('export')
    .description('Export index to JSONL or SQLite')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--format <format>', 'Export format (jsonl|sqlite)', 'jsonl')
    .option('--output <path>', 'Output file (use - for stdout)')
    .option('--encrypt <password>', 'Encrypt export output with AES-256-GCM')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const result = await manager.indexRepository(config.repository, config.indexing);
      const format = options.format ?? config.export?.format ?? 'jsonl';
      const password: string | undefined = options.encrypt;

      if (format === 'jsonl') {
        const output = options.output ?? config.export?.output ?? 'index.jsonl';
        if (output === '-') {
          if (password) {
            console.error('Encryption is not supported when writing JSONL to stdout.');
            process.exit(1);
          }
          await exportIndexToJsonl(result, process.stdout);
        } else {
          const target = resolve(output);
          await ensureDir(target);
          if (password) {
            const writer = createEncryptedFileWriter(target, password);
            await exportIndexToJsonl(result, writer.stream);
            await writer.finalize();
            console.log(`Exported encrypted JSONL to ${target}`);
          } else {
            const stream = createWriteStream(target, { encoding: 'utf8' });
            await exportIndexToJsonl(result, stream);
            stream.end();
            console.log(`Exported JSONL to ${target}`);
          }
          const digest = await computeSha256(target);
          console.log(`SHA-256: ${digest}`);
        }
      } else {
        const output = options.output ?? config.export?.output ?? 'index.sqlite';
        const target = resolve(output);
        await ensureDir(target);
        if (password) {
          const buffer = await buildSqliteBuffer(result);
          const encrypted = encryptBuffer(buffer, password);
          await writeFile(target, encrypted);
          console.log(`Exported encrypted SQLite to ${target}`);
        } else {
          await exportIndexToSqlite(result, target);
          console.log(`Exported SQLite to ${target}`);
        }
        const digest = await computeSha256(target);
        console.log(`SHA-256: ${digest}`);
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
      const notifierOptions = config.server?.airGap
        ? undefined
        : {
            webhookUrl: config.server?.webhookUrl,
            queueName: config.server?.queueName,
          };
      const server = createServer(manager, {
        spec: config.repository,
        indexOptions: config.indexing,
        notifier: notifierOptions,
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
