import { performance } from 'node:perf_hooks';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { IndexManager, IndexOptions, IndexResult, PullRequestIdentifier, PullRequestIndexOptions } from '../indexer';
import { RepositorySpec } from '../ingest';
import { recordIndexMetrics, withSpan, captureCpuProfile, captureHeapSnapshot } from '../observability';
import { IndexNotifier } from '../api/notifier';
import { exportIndexToJsonl } from '../exporters/jsonl';
import { buildSqliteBuffer } from '../exporters/sqlite';
import { buildRecommendations } from '../recommendation';
import type { IntegrationsConfig } from '../config';
import { getLogger } from '../common/logger';
import { McpInvocationContext, McpToolDefinition, McpToolDescriptor } from './types';
import { normalizeProviderKind } from '../api/providers';

interface McpAdapterOptions {
  indexManager: IndexManager;
  spec: RepositorySpec;
  indexOptions?: IndexOptions;
  notifier?: IndexNotifier;
  integrations?: IntegrationsConfig;
  emitEvent?: (event: string, payload: unknown) => void;
  onIndexCompleted?: (result: IndexResult) => void;
  defaultRoles?: string[];
}

export class McpToolAdapter {
  private readonly tools = new Map<string, McpToolDefinition>();
  private readonly log = getLogger('mcp:adapter');
  private readonly defaultRoles: string[];

  constructor(private readonly options: McpAdapterOptions) {
    this.defaultRoles = options.defaultRoles ?? ['reader'];
    this.registerTools();
  }

  getTool(name: string): McpToolDefinition | undefined {
    return this.tools.get(name);
  }

  listTools(): McpToolDescriptor[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      roles: tool.roles,
    }));
  }

  private registerTools() {
    this.addTool({
      name: 'list_files',
      description: 'List indexed files with optional include/exclude filters.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string; include?: string[]; exclude?: string[] };
        const include = Array.isArray(params.include) ? params.include : undefined;
        const exclude = Array.isArray(params.exclude) ? params.exclude : undefined;
        const files = this.options.indexManager.listFiles(this.options.spec, {
          ref: params.ref,
          include,
          exclude,
        });
        return { files };
      },
    });

    this.addTool({
      name: 'get_file',
      description: 'Retrieve a single indexed file including content and secret findings.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { path?: string; ref?: string };
        if (!params.path || typeof params.path !== 'string') {
          throw new Error('Parameter "path" is required.');
        }
        const file = this.options.indexManager.getFile(this.options.spec, params.path, params.ref);
        return { file };
      },
    });

    this.addTool({
      name: 'list_chunks',
      description: 'List chunks for the indexed repository, optionally filtered by path or language.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string; path?: string; lang?: string; maxTokens?: number };
        const chunks = this.options.indexManager.listChunks(this.options.spec, {
          ref: params.ref,
          path: params.path,
          lang: params.lang,
          maxTokens: params.maxTokens,
        });
        return { chunks };
      },
    });

    this.addTool({
      name: 'get_chunk',
      description: 'Retrieve a specific chunk by chunk identifier.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { id?: string; ref?: string };
        if (!params.id || typeof params.id !== 'string') {
          throw new Error('Parameter "id" is required.');
        }
        const chunk = this.options.indexManager.getChunk(this.options.spec, params.id, params.ref);
        return { chunk };
      },
    });

    this.addTool({
      name: 'search_text',
      description: 'Full-text search within indexed chunks.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { q?: string; pathGlob?: string; ref?: string };
        if (!params.q || typeof params.q !== 'string') {
          throw new Error('Parameter "q" is required.');
        }
        const matches = this.options.indexManager.searchText(this.options.spec, params.q, {
          ref: params.ref,
          pathGlob: params.pathGlob,
        });
        return { matches };
      },
    });

    this.addTool({
      name: 'search_symbols',
      description: 'Search the symbol index for declarations matching the query.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { q?: string; ref?: string };
        const matches = this.options.indexManager.searchSymbols(this.options.spec, params.q, { ref: params.ref });
        return { matches };
      },
    });

    this.addTool({
      name: 'diff_chunks',
      description: 'Diff chunks between two refs, returning added/removed chunks.',
      roles: ['integrator', 'maintainer'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { baseRef?: string; headRef?: string; paths?: string[]; limit?: number; ref?: string };
        if (!params.baseRef || !params.headRef) {
          throw new Error('Parameters "baseRef" and "headRef" are required.');
        }
        const diff = await this.options.indexManager.diffChunks(this.options.spec, {
          baseRef: params.baseRef,
          headRef: params.headRef,
          paths: Array.isArray(params.paths) ? params.paths : undefined,
          limit: params.limit,
          indexOptions: this.options.indexOptions,
        });
        return diff;
      },
    });

    this.addTool({
      name: 'blame_file',
      description: 'Retrieve git blame metadata for the given file path.',
      roles: ['integrator', 'maintainer'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { path?: string; ref?: string };
        if (!params.path || typeof params.path !== 'string') {
          throw new Error('Parameter "path" is required.');
        }
        return this.options.indexManager.blameFile(this.options.spec, { path: params.path, ref: params.ref });
      },
    });

    this.addTool({
      name: 'resolve_ref',
      description: 'Resolve a git ref to a commit hash.',
      roles: ['reader'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string };
        if (!params.ref || typeof params.ref !== 'string') {
          throw new Error('Parameter "ref" is required.');
        }
        const commit = await this.options.indexManager.resolveReference(this.options.spec, params.ref);
        return { ref: params.ref, commit };
      },
    });

    this.addTool({
      name: 'context_pack',
      description: 'Build a curated set of chunks for contextual responses.',
      roles: ['reader', 'integrator'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string; paths?: string[]; limit?: number; maxTokens?: number };
        const pack = await this.options.indexManager.buildContextPack(this.options.spec, {
          ref: params.ref,
          paths: Array.isArray(params.paths) ? params.paths : undefined,
          limit: params.limit,
          maxTokens: params.maxTokens,
          indexOptions: this.options.indexOptions,
        });
        return pack;
      },
    });

    this.addTool({
      name: 'recommend_context',
      description: 'Suggest high-signal chunks for assistants or IDE integrations.',
      roles: ['reader', 'integrator'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { limit?: number; maxTokens?: number; ref?: string };
        let index = this.options.indexManager.getIndex(this.options.spec, params.ref ?? this.options.indexOptions?.ref);
        if (!index) {
          index = await this.options.indexManager.indexRepository(this.options.spec, {
            ...this.options.indexOptions,
            ref: params.ref ?? this.options.indexOptions?.ref,
            dryRun: true,
          });
        }
        const recommendations = buildRecommendations(index, {
          limit: params.limit,
          maxTokens: params.maxTokens,
        });
        return { recommendations };
      },
    });

    this.addTool({
      name: 'map_tests',
      description: 'Return the indexed test-to-source map.',
      roles: ['integrator'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string };
        let index = this.options.indexManager.getIndex(this.options.spec, params.ref ?? this.options.indexOptions?.ref);
        if (!index) {
          index = await this.options.indexManager.indexRepository(this.options.spec, {
            ...this.options.indexOptions,
            ref: params.ref ?? this.options.indexOptions?.ref,
            dryRun: true,
          });
        }
        return { tests: index.testCoverage ?? {} };
      },
    });

    this.addTool({
      name: 'get_dependency_graph',
      description: 'Return the dependency graph recorded during indexing.',
      roles: ['integrator'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string };
        let index = this.options.indexManager.getIndex(this.options.spec, params.ref ?? this.options.indexOptions?.ref);
        if (!index) {
          index = await this.options.indexManager.indexRepository(this.options.spec, {
            ...this.options.indexOptions,
            ref: params.ref ?? this.options.indexOptions?.ref,
            dryRun: true,
          });
        }
        return { graph: index.dependencyGraph ?? {} };
      },
    });

    this.addTool({
      name: 'get_symbol_index',
      description: 'Return the cached symbol index.',
      roles: ['integrator'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string };
        let index = this.options.indexManager.getIndex(this.options.spec, params.ref ?? this.options.indexOptions?.ref);
        if (!index) {
          index = await this.options.indexManager.indexRepository(this.options.spec, {
            ...this.options.indexOptions,
            ref: params.ref ?? this.options.indexOptions?.ref,
            dryRun: true,
          });
        }
        return { symbols: index.symbolIndex ?? {} };
      },
    });

    this.addTool({
      name: 'export_jsonl',
      description: 'Export the current index as a JSONL payload encoded as base64.',
      roles: ['maintainer'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string };
        const index = this.requireIndex(params.ref);
        const buffer = await this.exportJsonlToBuffer(index);
        return {
          encoding: 'base64',
          filename: `index-${index.ref ?? params.ref ?? 'HEAD'}.jsonl`,
          size: buffer.length,
          data: buffer.toString('base64'),
        };
      },
    });

    this.addTool({
      name: 'export_sqlite',
      description: 'Export the current index as a SQLite database encoded as base64.',
      roles: ['maintainer'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { ref?: string };
        const index = this.requireIndex(params.ref);
        const buffer = await buildSqliteBuffer(index);
        return {
          encoding: 'base64',
          filename: `index-${index.ref ?? params.ref ?? 'HEAD'}.sqlite`,
          size: buffer.length,
          data: buffer.toString('base64'),
        };
      },
    });

    this.addTool({
      name: 'capture_cpu_profile',
      description: 'Capture a CPU profile for the MCP server process.',
      roles: ['maintainer'],
      handler: async (raw) => {
        const params = (raw ?? {}) as { durationMs?: number };
        const duration = Math.min(Math.max(params.durationMs ?? 5000, 50), 600000);
        const profile = await captureCpuProfile(duration);
        const encoded = Buffer.from(JSON.stringify(profile)).toString('base64');
        return {
          profile: encoded,
          format: 'cpuprofile',
          encoding: 'base64',
          durationMs: duration,
        };
      },
    });

    this.addTool({
      name: 'capture_heap_snapshot',
      description: 'Capture a heap snapshot for the MCP server process.',
      roles: ['maintainer'],
      handler: async () => {
        const snapshot = await captureHeapSnapshot();
        const encoded = Buffer.from(snapshot, 'utf8').toString('base64');
        return {
          snapshot: encoded,
          format: 'heapsnapshot',
          encoding: 'base64',
        };
      },
    });

    this.addTool({
      name: 'index_repository',
      description: 'Run a repository indexing cycle and publish metrics.',
      roles: ['maintainer'],
      handler: async (raw, context) => {
        const params = (raw ?? {}) as { ref?: string; incremental?: boolean };
        const base = this.options.indexOptions ? { ...this.options.indexOptions } : {};
        const ref = params.ref ?? base.ref;
        const optionsForRun: IndexOptions = {
          ...base,
          ref,
        };
        if (typeof params.incremental === 'boolean') {
          optionsForRun.incremental = params.incremental;
        }
        const correlationId = randomUUID();
        this.emitEvent('indexing.started', {
          correlationId,
          ref: ref ?? 'HEAD',
          incremental: Boolean(optionsForRun.incremental),
        });
        const started = performance.now();
        try {
          const result = await withSpan(
            'repo-tokenizer.index.mcp',
            {
              'repo.tokenizer.repository_type': this.options.spec.type,
              'repo.tokenizer.incremental': Boolean(optionsForRun.incremental),
              'repo.tokenizer.channel': 'mcp',
            },
            () => this.options.indexManager.indexRepository(this.options.spec, optionsForRun),
          );
          const durationMs = Math.round((performance.now() - started) * 100) / 100;
          const metrics = {
            timestamp: new Date().toISOString(),
            ref: result.ref ?? optionsForRun.ref ?? 'HEAD',
            files: result.files.length,
            chunks: result.chunks.length,
            secrets: result.secretFindings.length,
            durationMs,
            incremental: Boolean(optionsForRun.incremental),
            repositoryType: this.options.spec.type,
          };
          recordIndexMetrics(metrics);
          this.options.onIndexCompleted?.(result);
          if (this.options.notifier) {
            await this.options.notifier.notify({
              specPath: this.options.spec.path ?? '',
              ref: result.ref,
              files: result.files.length,
              chunks: result.chunks.length,
              createdAt: result.createdAt,
            });
          }
          this.emitEvent('indexing.completed', {
            ref: metrics.ref,
            metrics,
            source: 'index_repository',
            correlationId,
          });
          return {
            message: 'indexing complete',
            files: result.files.length,
            chunks: result.chunks.length,
            secrets: result.secretFindings.length,
            ref: result.ref,
            resumeCursor: result.resumeCursor,
            metrics,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.emitEvent('indexing.failed', {
            ref: ref ?? 'HEAD',
            message,
            source: 'index_repository',
            correlationId,
          });
          throw error;
        }
      },
    });

    this.addTool({
      name: 'index_pull_request',
      description: 'Index a pull request using configured integrations.',
      roles: ['maintainer'],
      handler: async (raw) => {
        const params = (raw ?? {}) as {
          provider?: string;
          id?: number;
          comment?: boolean;
          status?: boolean;
          failOnSecrets?: boolean;
          statusContext?: string;
          statusTargetUrl?: string;
          commentTemplate?: string;
        };

        if (typeof params.id !== 'number') {
          throw new Error('Parameter "id" (number) is required.');
        }

        const provider = normalizeProviderKind(
          params.provider ?? this.options.integrations?.pullRequests?.defaultProvider,
        );
        if (!provider) {
          throw new Error('Pull request provider not specified or unsupported');
        }

        const providerConfigs: PullRequestIndexOptions['providers'] = {
          github: this.options.integrations?.github,
          gitlab: this.options.integrations?.gitlab,
        };

        if (provider === 'github' && !providerConfigs.github) {
          throw new Error('GitHub integration is not configured on the server');
        }
        if (provider === 'gitlab' && !providerConfigs.gitlab) {
          throw new Error('GitLab integration is not configured on the server');
        }

        const workflow = this.options.integrations?.pullRequests;
        const commentEnabled = typeof params.comment === 'boolean' ? params.comment : Boolean(workflow?.autoComment);
        const statusEnabled = typeof params.status === 'boolean' ? params.status : Boolean(workflow?.autoStatusCheck);
        const failOnSecrets = typeof params.failOnSecrets === 'boolean'
          ? params.failOnSecrets
          : Boolean(workflow?.failOnSecretFindings);
        const statusContext = params.statusContext ?? workflow?.statusContext;
        const statusTargetUrl = params.statusTargetUrl ?? workflow?.statusTargetUrl;
        const template = params.commentTemplate ?? workflow?.commentTemplate;

        const identifier: PullRequestIdentifier = { provider, id: params.id };
        const prOptions: PullRequestIndexOptions = {
          providers: providerConfigs,
          indexOptions: this.options.indexOptions,
          comment: { enabled: commentEnabled, template },
          status: {
            enabled: statusEnabled,
            context: statusContext,
            targetUrl: statusTargetUrl,
            failOnSecretFindings: failOnSecrets,
          },
        };

        const correlationId = randomUUID();
        this.emitEvent('indexing.started', {
          correlationId,
          ref: params.id.toString(),
          provider,
          source: 'index_pull_request',
        });

        const started = performance.now();
        try {
          const result = await withSpan(
            'repo-tokenizer.index.pull-request',
            {
              'repo.tokenizer.provider': provider,
              'repo.tokenizer.repository_type': this.options.spec.type,
              'repo.tokenizer.channel': 'mcp',
            },
            () => this.options.indexManager.indexPullRequest(this.options.spec, identifier, prOptions),
          );
          const durationMs = Math.round((performance.now() - started) * 100) / 100;
          const metrics = {
            timestamp: new Date().toISOString(),
            ref: result.index.ref ?? prOptions.indexOptions?.ref ?? 'HEAD',
            files: result.index.files.length,
            chunks: result.index.chunks.length,
            secrets: result.index.secretFindings.length,
            durationMs,
            incremental: Boolean(prOptions.indexOptions?.incremental),
            repositoryType: this.options.spec.type,
            provider,
            pullRequestId: result.pullRequest.number,
          };
          recordIndexMetrics(metrics);
          this.options.onIndexCompleted?.(result.index);
          this.emitEvent('indexing.completed', {
            ref: metrics.ref,
            provider,
            pullRequestId: result.pullRequest.number,
            metrics,
            source: 'index_pull_request',
            correlationId,
          });
          return {
            message: 'pull request indexed',
            provider,
            id: result.pullRequest.number,
            files: result.index.files.length,
            chunks: result.index.chunks.length,
            secrets: result.index.secretFindings.length,
            statusSubmitted: result.statusSubmitted,
            commentSubmitted: result.commentSubmitted,
            status: result.statusPayload,
            metrics,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.emitEvent('indexing.failed', {
            ref: params.id.toString(),
            provider,
            message,
            source: 'index_pull_request',
            correlationId,
          });
          throw error;
        }
      },
    });
  }

  private addTool(definition: McpToolDefinition) {
    this.tools.set(definition.name, definition);
  }

  private emitEvent(event: string, payload: unknown) {
    if (this.options.emitEvent) {
      try {
        this.options.emitEvent(event, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.log.warn(`Failed to emit MCP event "${event}": ${message}`);
      }
    }
  }

  private requireIndex(ref?: string): IndexResult {
    const targetRef = ref ?? this.options.indexOptions?.ref;
    const index = this.options.indexManager.getIndex(this.options.spec, targetRef);
    if (!index) {
      throw new Error('Index not found. Run index_repository first.');
    }
    return index;
  }

  private async exportJsonlToBuffer(index: IndexResult): Promise<Buffer> {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    await exportIndexToJsonl(index, stream);
    stream.end();
    await once(stream, 'end');
    return Buffer.concat(chunks);
  }
}
