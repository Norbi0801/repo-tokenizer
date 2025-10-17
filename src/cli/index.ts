#!/usr/bin/env node
import { Command } from 'commander';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createWriteStream, createReadStream } from 'node:fs';
import chokidar from 'chokidar';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { RepoTokenizerConfig, loadConfig } from '../config';
import { IndexManager, IndexOptions, PullRequestIdentifier, PullRequestIndexOptions } from '../indexer';
import type { GitProviderKind } from '../integrations';
import {
  recordIndexMetrics,
  withSpan,
  startCpuProfiling,
  writeCpuProfile,
  writeHeapSnapshot,
} from '../observability';
import { configureLogger, getLogger, LogLevel, LogFormat } from '../common/logger';
import { buildQualityReport, renderQualityReportHtml, renderQualityReportTui } from '../reports';
import { exportIndexToJsonl } from '../exporters/jsonl';
import { exportIndexToSqlite, buildSqliteBuffer } from '../exporters/sqlite';
import { createEncryptedFileWriter, encryptBuffer } from '../exporters/encryption';
import { exportIndexToParquet } from '../exporters/parquet';
import { buildDeltaSnapshot } from '../exporters/delta';
import { exportVectors, VectorTarget } from '../exporters/vector';
import { buildRecommendations } from '../recommendation';
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
integrations:
  pullRequests:
    defaultProvider: github
    autoComment: false
    autoStatusCheck: false
    failOnSecretFindings: false
    statusContext: repo-tokenizer/index
    statusTargetUrl: null
    commentTemplate: null
  github:
    owner: your-org
    repo: your-repo
    tokenEnv: GITHUB_TOKEN
  gitlab:
    projectId: your-group/your-repo
    tokenEnv: GITLAB_TOKEN
`;
}

async function ensureDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function loadConfigOrExit(path: string, profile?: string): Promise<RepoTokenizerConfig> {
  try {
    return await loadConfig(path, profile);
  } catch (error) {
    getLogger('cli').error(`Failed to load config: ${(error as Error).message}`);
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

function normalizeProvider(value?: string): GitProviderKind | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'github' || normalized === 'gitlab') {
    return normalized;
  }
  return undefined;
}

function resolveMode(mode: string | undefined, fallback: boolean): boolean {
  if (!mode || mode === 'auto') {
    return fallback;
  }
  if (mode === 'on') {
    return true;
  }
  if (mode === 'off') {
    return false;
  }
  throw new Error(`Unsupported mode "${mode}". Expected one of: auto, on, off.`);
}

async function loadTemplateFromPath(path?: string): Promise<string | undefined> {
  if (!path) {
    return undefined;
  }
  const absolute = resolve(path);
  return readFile(absolute, 'utf8');
}

function parseLogLevel(value?: string): LogLevel | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (['silent', 'error', 'warn', 'info', 'debug'].includes(normalized)) {
    return normalized as LogLevel;
  }
  throw new Error(`Unsupported log level "${value}". Use one of silent,error,warn,info,debug.`);
}

function parseLogFormat(value?: string): LogFormat | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'json' || normalized === 'text') {
    return normalized as LogFormat;
  }
  throw new Error(`Unsupported log format "${value}". Use text or json.`);
}

export async function runCli(argv = process.argv) {
  const program = new Command();
  program.name('repo-tokenizer-mcp').description('Repository tokenizer CLI');
  const rootLogger = getLogger('cli');

  program
    .option('--log-level <level>', 'Log level (silent|error|warn|info|debug)', process.env.REPO_TOKENIZER_LOG_LEVEL)
    .option('--log-format <format>', 'Log format (text|json)', process.env.REPO_TOKENIZER_LOG_FORMAT)
    .hook('preAction', (cmd) => {
      const opts = cmd.optsWithGlobals<typeof cmd & { logLevel?: string; logFormat?: string }>();
      try {
        const level = parseLogLevel(opts.logLevel);
        const format = parseLogFormat(opts.logFormat);
        configureLogger({ level, format, destination: process.stderr });
      } catch (error) {
        console.error((error as Error).message);
        process.exit(1);
      }
    });

  program
    .command('init')
    .description('Create sample configuration file')
    .option('--config <path>', 'Config path', '.repo-tokenizer.yaml')
    .action(async (options) => {
      const log = getLogger('cli:init');
      const target = resolve(options.config);
      await ensureDir(target);
      await writeFile(target, buildSampleConfig(), { flag: 'wx' }).catch(async (error) => {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          log.error(`Config file already exists at ${target}`);
          process.exit(1);
        }
        throw error;
      });
      log.info(`Created config at ${target}`);
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
    .option('--include <paths...>', 'Limit indexing to specified paths (space separated)')
    .option('--metrics-json <path>', 'Write metrics summary to JSON file')
    .option('--metrics-stdout', 'Emit metrics summary as JSON to stdout')
    .option('--cpu-profile <path>', 'Write CPU profile (Chrome DevTools format) after indexing')
    .option('--heap-snapshot <path>', 'Write heap snapshot after indexing')
    .option('--dry-run', 'Run indexing without caching results')
    .option('--quality-report <path>', 'Write chunk quality report to file (JSON)')
    .option('--quality-report-base <ref>', 'Optional baseline ref for report diff')
    .action(async (options) => {
      const log = getLogger('cli:index');
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const watchEnabled = Boolean(options.watch);
      const intervalSec = options.interval ? Number(options.interval) : undefined;
      const includePathsOverride: string[] | undefined = options.include
        ? (Array.isArray(options.include) ? options.include : [options.include])
        : undefined;
      const metricsJsonPath = options.metricsJson ? resolve(options.metricsJson) : undefined;
      const metricsStdout = Boolean(options.metricsStdout);
      const cpuProfilePath = options.cpuProfile ? resolve(options.cpuProfile) : undefined;
      const heapSnapshotPath = options.heapSnapshot ? resolve(options.heapSnapshot) : undefined;
      const qualityReportPath = options.qualityReport
        ? resolve(options.qualityReport)
        : config.indexing?.qualityReportPath
          ? resolve(config.indexing.qualityReportPath)
          : undefined;
      const qualityReportBase = options.qualityReportBase ?? config.indexing?.qualityReportBase;
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
          const started = performance.now();
          const incrementalOptions: IndexOptions = {
            ref: options.ref ?? config.indexing?.ref,
            tokenizerId: config.indexing?.tokenizerId,
            excludeGlobs: config.indexing?.excludeGlobs,
            sparsePatterns: config.indexing?.sparsePatterns,
            chunking: config.indexing?.chunking,
            concurrency: config.indexing?.concurrency,
            maxInFlightBytes: config.indexing?.maxInFlightBytes,
            sharding: config.indexing?.sharding,
            maxFilesPerRun: config.indexing?.maxFilesPerRun,
            resumeCursor: config.indexing?.resumeCursor,
            dryRun: config.indexing?.dryRun,
            domain: config.indexing?.domain,
            languageChunkProfiles: config.indexing?.languageChunkProfiles,
          };

          if (includePathsOverride && includePathsOverride.length > 0) {
            incrementalOptions.includePaths = [...includePathsOverride];
          } else if (config.indexing?.includePaths) {
            incrementalOptions.includePaths = config.indexing.includePaths;
          }

          if (options.dryRun) {
            incrementalOptions.dryRun = true;
          }

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

          const result = await withSpan(
            'repo-tokenizer.index.cli',
            {
              'repo.tokenizer.repository_type': config.repository.type,
              'repo.tokenizer.incremental': Boolean(incrementalOptions.incremental),
            },
            () => manager.indexRepository(config.repository, incrementalOptions),
          );
          const priorResult = lastResult;
          lastResult = result;
          const durationMs = Math.round((performance.now() - started) * 100) / 100;
          log.info(
            `Indexed ${result.files.length} files, ${result.chunks.length} chunks (ref=${result.ref ?? 'HEAD'})`,
          );
          if (options.secretsReport) {
            const reportPath = resolve(options.secretsReport);
            await ensureDir(reportPath);
            await writeFile(reportPath, JSON.stringify(result.secretFindings, null, 2));
            log.info(`Secret findings written to ${reportPath}`);
          }
          const metricsEvent = {
            event: 'repo-tokenizer.index',
            metrics: {
              timestamp: new Date().toISOString(),
              ref: result.ref ?? incrementalOptions.ref ?? 'HEAD',
              files: result.files.length,
              chunks: result.chunks.length,
              secrets: result.secretFindings.length,
              durationMs,
              incremental: Boolean(incrementalOptions.incremental),
              includePaths: incrementalOptions.includePaths ?? [],
              repositoryType: config.repository.type,
            },
          };
          recordIndexMetrics(metricsEvent.metrics);
          if (metricsStdout) {
            process.stdout.write(`${JSON.stringify(metricsEvent)}\n`);
          }
          if (metricsJsonPath) {
            await ensureDir(metricsJsonPath);
            await writeFile(metricsJsonPath, JSON.stringify(metricsEvent, null, 2));
            log.info(`Metrics written to ${metricsJsonPath}`);
          }

          if (qualityReportPath) {
            let baseline: typeof result | undefined;
            if (qualityReportBase) {
              baseline = manager.getIndex(config.repository, qualityReportBase) ?? undefined;
              if (!baseline) {
                try {
                  baseline = await manager.indexRepository(config.repository, {
                    ref: qualityReportBase,
                    tokenizerId: incrementalOptions.tokenizerId,
                    chunking: incrementalOptions.chunking,
                    includePaths: incrementalOptions.includePaths,
                    excludeGlobs: incrementalOptions.excludeGlobs,
                    sparsePatterns: incrementalOptions.sparsePatterns,
                    scanSecrets: incrementalOptions.scanSecrets,
                    secretPatterns: incrementalOptions.secretPatterns,
                    dryRun: true,
                  });
                } catch (error) {
                  log.warn(
                    `Baseline quality indexing failed for ref ${qualityReportBase}: ${(error as Error).message}`,
                  );
                }
              }
            } else if (priorResult) {
              baseline = priorResult;
            }

            const qualityReport = buildQualityReport(result, baseline);
            await ensureDir(qualityReportPath);
            await writeFile(qualityReportPath, JSON.stringify(qualityReport, null, 2));
            log.info(`Quality report written to ${qualityReportPath}`);
          }
        } catch (error) {
          log.error(`Index failed: ${(error as Error).message}`);
        } finally {
          running = false;
          if (pending) {
            pending = false;
            runIndex();
          }
        }
      };

      if (cpuProfilePath) {
        await ensureDir(cpuProfilePath);
        await startCpuProfiling();
        if (watchEnabled || intervalSec) {
          log.warn('CPU profiling will capture the first run only when watch/interval is enabled.');
        }
      }
      if (heapSnapshotPath && (watchEnabled || intervalSec)) {
        log.warn('Heap snapshot will be captured after the first run only.');
      }

      await runIndex();

      if (cpuProfilePath) {
        await writeCpuProfile(cpuProfilePath);
        log.info(`CPU profile written to ${cpuProfilePath}`);
      }
      if (heapSnapshotPath) {
        await ensureDir(heapSnapshotPath);
        await writeHeapSnapshot(heapSnapshotPath);
        log.info(`Heap snapshot written to ${heapSnapshotPath}`);
      }

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
          log.info('Watching for changes...');
        } else {
          log.warn('Watch mode requires local filesystem path.');
        }
      }

      let intervalHandle: NodeJS.Timeout | undefined;
      if (intervalSec && intervalSec > 0) {
        intervalHandle = setInterval(runIndex, intervalSec * 1000);
        log.info(`Scheduled re-index every ${intervalSec} seconds.`);
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
    .command('pr')
    .description('Index pull/merge request and update provider integrations')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .requiredOption('--id <number>', 'Pull request number (GitHub) or merge request IID (GitLab)')
    .option('--provider <name>', 'Provider override (github|gitlab)')
    .option('--comment-mode <mode>', 'Comment behaviour: auto|on|off', 'auto')
    .option('--status-mode <mode>', 'Status check behaviour: auto|on|off', 'auto')
    .option('--status-context <value>', 'Status context override')
    .option('--status-target-url <url>', 'Status target URL override')
    .option('--fail-on-secrets', 'Mark status as failure when secrets detected')
    .option('--template <path>', 'Comment template override path')
    .action(async (options) => {
      try {
        const log = getLogger('cli:pr');
        const config = await loadConfigOrExit(options.config, options.profile);
        const idNum = Number(options.id);
        if (Number.isNaN(idNum)) {
          log.error('Invalid pull/merge request id. Expected a numeric value.');
          process.exit(1);
        }

        const providerFromConfig = normalizeProvider(config.integrations?.pullRequests?.defaultProvider);
        const provider = normalizeProvider(options.provider) ?? providerFromConfig;
        if (!provider) {
          log.error('Provider not specified. Use --provider or set integrations.pullRequests.defaultProvider.');
          process.exit(1);
        }

        const providerConfigs: PullRequestIndexOptions['providers'] = {
          github: config.integrations?.github,
          gitlab: config.integrations?.gitlab,
        };
        if (provider === 'github' && !providerConfigs.github) {
          log.error('GitHub integration missing. Configure integrations.github in your config file.');
          process.exit(1);
        }
        if (provider === 'gitlab' && !providerConfigs.gitlab) {
          log.error('GitLab integration missing. Configure integrations.gitlab in your config file.');
          process.exit(1);
        }

        const workflow = config.integrations?.pullRequests;
        const commentEnabled = resolveMode(options.commentMode, Boolean(workflow?.autoComment));
        const statusEnabled = resolveMode(options.statusMode, Boolean(workflow?.autoStatusCheck));
        const failOnSecrets = Boolean(options.failOnSecrets ?? workflow?.failOnSecretFindings);
        const statusContext = options.statusContext ?? workflow?.statusContext;
        const statusTargetUrl = options.statusTargetUrl ?? workflow?.statusTargetUrl;

        const templateOverride = await loadTemplateFromPath(options.template);
        const template = templateOverride ?? workflow?.commentTemplate;

        const manager = new IndexManager();
        const identifier: PullRequestIdentifier = { provider, id: idNum };
        const prOptions: PullRequestIndexOptions = {
          providers: providerConfigs,
          indexOptions: config.indexing,
          comment: {
            enabled: commentEnabled,
            template,
          },
          status: {
            enabled: statusEnabled,
            context: statusContext,
            targetUrl: statusTargetUrl,
            failOnSecretFindings: failOnSecrets,
          },
        };

        const prStart = performance.now();
        const result = await withSpan(
          'repo-tokenizer.index.pull-request.cli',
          {
            'repo.tokenizer.provider': provider,
            'repo.tokenizer.repository_type': config.repository.type,
          },
          () => manager.indexPullRequest(config.repository, identifier, prOptions),
        );
        const prDuration = Math.round((performance.now() - prStart) * 100) / 100;

        recordIndexMetrics({
          timestamp: new Date().toISOString(),
          ref: result.index.ref ?? config.indexing?.ref ?? result.pullRequest.headSha,
          files: result.index.files.length,
          chunks: result.index.chunks.length,
          secrets: result.index.secretFindings.length,
          durationMs: prDuration,
          incremental: Boolean(config.indexing?.incremental),
          repositoryType: config.repository.type,
        });

        log.info(
          `Indexed ${provider === 'github' ? 'PR' : 'MR'} #${result.pullRequest.number} (${result.pullRequest.headRef} → ${result.pullRequest.baseRef})`,
        );
        log.info(`Files: ${result.index.files.length}, Chunks: ${result.index.chunks.length}`);
        if (result.index.secretFindings.length > 0) {
          log.warn(`Secret findings: ${result.index.secretFindings.length}`);
        }
        if (statusEnabled) {
          const state = result.statusPayload?.state ?? 'unknown';
          log.info(`Status ${result.statusSubmitted ? 'submitted' : 'skipped'} (state=${state})`);
        }
        if (commentEnabled) {
          log.info(`Comment ${result.commentSubmitted ? 'posted' : 'skipped'}.`);
        }
        if (failOnSecrets && result.index.secretFindings.length > 0) {
          log.error('Secrets detected in diff – marking run as failed due to --fail-on-secrets / config setting.');
          process.exitCode = 2;
        }
      } catch (error) {
        getLogger('cli:pr').error(`Pull request indexing failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  program
    .command('report')
    .description('Generate quality report for repository indexing')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--ref <ref>', 'Target ref to analyse')
    .option('--baseline <ref>', 'Baseline ref for diff metrics')
    .option('--json <path>', 'Write report to JSON file')
    .option('--html <path>', 'Write report to HTML file')
    .option('--tui', 'Render report in terminal UI')
    .action(async (options) => {
      const log = getLogger('cli:report');
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const ref = options.ref ?? config.indexing?.ref;
      const baselineRef = options.baseline ?? config.indexing?.qualityReportBase;
      const indexingOptions: IndexOptions = {
        ...config.indexing,
        ref,
        dryRun: true,
      };

      const current = await manager.indexRepository(config.repository, indexingOptions);
      let baseline;
      if (baselineRef) {
        baseline = manager.getIndex(config.repository, baselineRef);
        if (!baseline) {
          try {
            baseline = await manager.indexRepository(config.repository, {
              ...config.indexing,
              ref: baselineRef,
              dryRun: true,
            });
          } catch (error) {
            log.warn(`Baseline indexing failed (${baselineRef}): ${(error as Error).message}`);
          }
        }
      }

      const report = buildQualityReport(current, baseline);

      if (options.json) {
        const target = resolve(options.json);
        await ensureDir(target);
        await writeFile(target, JSON.stringify(report, null, 2));
        log.info(`Report JSON written to ${target}`);
      }

      if (options.html) {
        const target = resolve(options.html);
        await ensureDir(target);
        const html = renderQualityReportHtml(report, { title: `Repo Tokenizer Report (${ref ?? 'HEAD'})` });
        await writeFile(target, html, 'utf8');
        log.info(`Report HTML written to ${target}`);
      }

      if (options.tui) {
        renderQualityReportTui(report);
      }

      if (!options.json && !options.html && !options.tui) {
        log.info('No output option selected; use --json, --html or --tui.');
      }
    });

  program
    .command('diff-chunks')
    .description('Compare chunk sets between two refs')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .requiredOption('--base <ref>', 'Base ref')
    .requiredOption('--head <ref>', 'Head ref')
    .option('--path <path...>', 'Limit diff to specific file paths')
    .option('--limit <number>', 'Maximum diff entries to return', '200')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const paths = options.path ? (Array.isArray(options.path) ? options.path : [options.path]) : undefined;
      const result = await manager.diffChunks(config.repository, {
        baseRef: options.base,
        headRef: options.head,
        paths,
        limit: Number(options.limit ?? '200'),
        indexOptions: config.indexing,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command('blame')
    .description('Return git blame information for a file')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .requiredOption('--path <path>', 'File path')
    .option('--ref <ref>', 'Git ref (defaults to HEAD)')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const result = await manager.blameFile(config.repository, { path: options.path, ref: options.ref });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command('resolve-ref')
    .description('Resolve ref to commit hash')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .requiredOption('--ref <ref>', 'Reference to resolve')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const commit = await manager.resolveReference(config.repository, options.ref);
      process.stdout.write(`${commit}\n`);
    });

  program
    .command('context-pack')
    .description('Build a high-signal chunk pack for contextualisation')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--ref <ref>', 'Target ref')
    .option('--path <path...>', 'Include only specific paths')
    .option('--limit <number>', 'Maximum chunks to include', '20')
    .option('--max-tokens <number>', 'Maximum tokens per chunk')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const paths = options.path ? (Array.isArray(options.path) ? options.path : [options.path]) : undefined;
      const result = await manager.buildContextPack(config.repository, {
        ref: options.ref ?? config.indexing?.ref,
        paths,
        limit: Number(options.limit ?? '20'),
        maxTokens: options.maxTokens ? Number(options.maxTokens) : undefined,
        indexOptions: config.indexing,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    });

  program
    .command('recommend')
    .description('Generate context recommendations based on current index')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--limit <number>', 'Maximum chunks per recommendation track', '5')
    .option('--max-tokens <number>', 'Ignore chunks larger than this token count')
    .option('--ref <ref>', 'Ref to analyze')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const index = await manager.indexRepository(config.repository, {
        ...config.indexing,
        ref: options.ref ?? config.indexing?.ref,
        dryRun: true,
      });
      const recommendations = buildRecommendations(index, {
        limit: Number(options.limit ?? '5'),
        maxTokens: options.maxTokens ? Number(options.maxTokens) : undefined,
      });
      process.stdout.write(`${JSON.stringify(recommendations, null, 2)}\n`);
    });

  program
    .command('tests-map')
    .description('Print inferred mapping between tests and source files')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--ref <ref>', 'Target ref')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const index = await manager.indexRepository(config.repository, {
        ...config.indexing,
        ref: options.ref ?? config.indexing?.ref,
        dryRun: true,
      });
      process.stdout.write(`${JSON.stringify(index.testCoverage ?? {}, null, 2)}\n`);
    });

  program
    .command('deps-graph')
    .description('Emit dependency graph inferred from import statements')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--ref <ref>', 'Target ref')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const index = await manager.indexRepository(config.repository, {
        ...config.indexing,
        ref: options.ref ?? config.indexing?.ref,
        dryRun: true,
      });
      process.stdout.write(`${JSON.stringify(index.dependencyGraph ?? {}, null, 2)}\n`);
    });

  program
    .command('symbols-index')
    .description('Emit indexed symbols for the repository')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--ref <ref>', 'Target ref')
    .action(async (options) => {
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const index = await manager.indexRepository(config.repository, {
        ...config.indexing,
        ref: options.ref ?? config.indexing?.ref,
        dryRun: true,
      });
      process.stdout.write(`${JSON.stringify(index.symbolIndex ?? {}, null, 2)}\n`);
    });

  program
    .command('export')
    .description('Export index to JSONL or SQLite')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--format <format>', 'Export format (jsonl|sqlite)', 'jsonl')
    .option('--output <path>', 'Output file (use - for stdout)')
    .option('--encrypt <password>', 'Encrypt export output with AES-256-GCM')
    .option('--delta-base <ref>', 'Base ref for delta export')
    .option('--vector-collection <name>', 'Collection/table name for vector exports')
    .option('--vector-dimension <number>', 'Embedding dimension for vector exports', '64')
    .action(async (options) => {
      const log = getLogger('cli:export');
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
      const result = await manager.indexRepository(config.repository, config.indexing);
      const format = options.format ?? config.export?.format ?? 'jsonl';
      const password: string | undefined = options.encrypt;

      if (format === 'jsonl') {
        const output = options.output ?? config.export?.output ?? 'index.jsonl';
        if (output === '-') {
          if (password) {
            log.error('Encryption is not supported when writing JSONL to stdout.');
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
            log.info(`Exported encrypted JSONL to ${target}`);
          } else {
            const stream = createWriteStream(target, { encoding: 'utf8' });
            await exportIndexToJsonl(result, stream);
            stream.end();
            log.info(`Exported JSONL to ${target}`);
          }
          const digest = await computeSha256(target);
          log.info(`SHA-256: ${digest}`);
        }
      } else if (format === 'sqlite') {
        const output = options.output ?? config.export?.output ?? 'index.sqlite';
        const target = resolve(output);
        await ensureDir(target);
        if (password) {
          const buffer = await buildSqliteBuffer(result);
          const encrypted = encryptBuffer(buffer, password);
          await writeFile(target, encrypted);
          log.info(`Exported encrypted SQLite to ${target}`);
        } else {
          await exportIndexToSqlite(result, target);
          log.info(`Exported SQLite to ${target}`);
        }
        const digest = await computeSha256(target);
        log.info(`SHA-256: ${digest}`);
      } else if (format === 'parquet') {
        const output = options.output ?? config.export?.output ?? 'index.parquet';
        const target = resolve(output);
        await ensureDir(target);
        await exportIndexToParquet(result, target);
        log.info(`Exported Parquet to ${target}`);
      } else if (format === 'delta') {
        const output = options.output ?? config.export?.output ?? 'index.delta.json';
        const target = resolve(output);
        await ensureDir(target);
        const baseRef = options.deltaBase ?? config.indexing?.baseRef;
        let baseResult;
        if (baseRef) {
          baseResult = await manager.indexRepository(config.repository, {
            ...config.indexing,
            ref: baseRef,
            dryRun: true,
          });
        }
        const delta = buildDeltaSnapshot(baseResult, result);
        await writeFile(target, JSON.stringify(delta, null, 2));
        log.info(`Delta snapshot written to ${target}`);
      } else if (format === 'faiss' || format === 'qdrant' || format === 'pgvector') {
        const output = options.output ?? config.export?.output ?? `index.${format}.json`;
        const target = resolve(output);
        await ensureDir(target);
        await exportVectors(result, {
          target: format as VectorTarget,
          collection: options.vectorCollection,
          tableName: options.vectorCollection,
          dimension: Number(options.vectorDimension ?? '64'),
        }, target);
        log.info(`Vector export (${format}) written to ${target}`);
      } else {
        throw new Error(`Unsupported export format: ${format}`);
      }
    });

  program
    .command('serve')
    .description('Start MCP server')
    .requiredOption('--config <path>', 'Config file path')
    .option('--profile <name>', 'Config profile')
    .option('--port <number>', 'Port override')
    .action(async (options) => {
      const log = getLogger('cli:serve');
      const config = await loadConfigOrExit(options.config, options.profile);
      const manager = new IndexManager();
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
        integrations: config.integrations,
      });
      await server.listen({ port, host });
      log.info(`Server listening on http://${host}:${port}`);
      if (config.indexing) {
        void (async () => {
          try {
            log.info('Starting background index bootstrap');
            const startTime = performance.now();
            const initial = await withSpan(
              'repo-tokenizer.index.bootstrap',
              {
                'repo.tokenizer.repository_type': config.repository.type,
              },
              () => manager.indexRepository(config.repository, config.indexing),
            );
            const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
            const metrics = {
              timestamp: new Date().toISOString(),
              ref: initial.ref ?? config.indexing?.ref ?? 'HEAD',
              files: initial.files.length,
              chunks: initial.chunks.length,
              secrets: initial.secretFindings.length,
              durationMs,
              incremental: Boolean(config.indexing?.incremental),
              repositoryType: config.repository.type,
            };
            recordIndexMetrics(metrics);
            server.applyBootstrap(initial);
            log.info('Background index bootstrap completed', metrics);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`Background index bootstrap failed: ${message}`);
          }
        })();
      }
      });

  program
    .command('completion')
    .description('Print shell completion script (bash)')
    .action(() => {
      const script = `#!/bin/bash
_repo_tokenizer_mcp_completions() {
  COMPREPLY=( $(compgen -W "init index report pr diff-chunks blame resolve-ref context-pack recommend tests-map deps-graph symbols-index export serve completion" -- "\${COMP_WORDS[COMP_CWORD]}") )
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
