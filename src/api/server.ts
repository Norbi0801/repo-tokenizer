import Fastify, { FastifyInstance } from 'fastify';
import { performance } from 'node:perf_hooks';
import { IndexManager } from '../indexer';
import { RepositorySpec } from '../ingest';
import { IndexOptions, PullRequestIdentifier, PullRequestIndexOptions, IndexResult } from '../indexer/types';
import { exportIndexToJsonl } from '../exporters/jsonl';
import { buildSqliteBuffer } from '../exporters/sqlite';
import { IndexNotifier, NotifierOptions } from './notifier';
import { once } from 'node:events';
import type { IntegrationsConfig } from '../config';
import type { GitProviderKind } from '../integrations';
import {
  recordIndexMetrics,
  withSpan,
  metricsContentType,
  getMetricsSnapshot,
  captureCpuProfile,
  captureHeapSnapshot,
} from '../observability';
import { buildQualityReport, renderQualityReportHtml } from '../reports';
import { getLogger } from '../common/logger';
import { buildRecommendations } from '../recommendation';

interface ServerOptions {
  spec: RepositorySpec;
  indexOptions?: IndexOptions;
  notifier?: NotifierOptions;
  integrations?: IntegrationsConfig;
}

export interface RepoTokenizerServer extends FastifyInstance {
  applyBootstrap(result: IndexResult): void;
}

export function createServer(indexManager: IndexManager, options: ServerOptions): RepoTokenizerServer {
  const log = getLogger('server');
  const app = Fastify({ logger: false }) as unknown as RepoTokenizerServer;
  const { spec, indexOptions, integrations } = options;
  const notifier = options.notifier ? new IndexNotifier(options.notifier) : undefined;
  let isReady = Boolean(indexManager.getIndex(spec, indexOptions?.ref));
  let lastIndex = indexOptions?.ref ? indexManager.getIndex(spec, indexOptions.ref) : undefined;
  let previousIndex = undefined as typeof lastIndex;
  app.applyBootstrap = (result: IndexResult) => {
    previousIndex = lastIndex;
    lastIndex = result;
    isReady = true;
  };

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/live', async () => ({ status: 'ok' }));

  app.get('/ready', async (request, reply) => {
    let ready = isReady || Boolean(lastIndex);
    if (!ready) {
      const existing = indexManager.getIndex(spec, indexOptions?.ref);
      if (existing) {
        app.applyBootstrap(existing);
        ready = true;
      }
    }
    if (!ready) {
      reply.status(503);
      return { status: 'starting' };
    }
    return { status: 'ok' };
  });

  app.get('/metrics', async (request, reply) => {
    const metrics = await getMetricsSnapshot();
    reply.header('Content-Type', metricsContentType());
    reply.send(metrics);
  });

  app.get('/dashboard', async (request, reply) => {
    if (!lastIndex) {
      reply.status(404);
      return { error: 'index not available' };
    }
    const report = buildQualityReport(lastIndex, previousIndex);
    const html = renderQualityReportHtml(report, {
      title: `Repo Tokenizer Report (${lastIndex.ref ?? 'HEAD'})`,
    });
    reply.header('Content-Type', 'text/html');
    reply.send(html);
  });

  app.post('/profiling/cpu', async (request) => {
    const body = request.body as { durationMs?: number } | undefined;
    const duration = Math.min(Math.max(body?.durationMs ?? 5000, 50), 600000);
    const profile = await captureCpuProfile(duration);
    const encoded = Buffer.from(JSON.stringify(profile)).toString('base64');
    return { profile: encoded, format: 'cpuprofile', encoding: 'base64', durationMs: duration };
  });

  app.post('/profiling/heap', async () => {
    const snapshot = await captureHeapSnapshot();
    const encoded = Buffer.from(snapshot, 'utf8').toString('base64');
    return { snapshot: encoded, format: 'heapsnapshot', encoding: 'base64' };
  });

  app.post('/mcp/diff-chunks', async (request) => {
    const body = request.body as { baseRef?: string; headRef?: string; paths?: string[]; limit?: number };
    if (!body.baseRef || !body.headRef) {
      throw new Error('baseRef and headRef are required');
    }
    const diff = await indexManager.diffChunks(spec, {
      baseRef: body.baseRef,
      headRef: body.headRef,
      paths: body.paths,
      limit: body.limit,
      indexOptions,
    });
    return diff;
  });

  app.post('/mcp/blame', async (request) => {
    const body = request.body as { path?: string; ref?: string };
    if (!body.path) {
      throw new Error('path is required');
    }
    return indexManager.blameFile(spec, { path: body.path, ref: body.ref });
  });

  app.post('/mcp/resolve-ref', async (request) => {
    const body = request.body as { ref?: string };
    if (!body.ref) {
      throw new Error('ref is required');
    }
    const commit = await indexManager.resolveReference(spec, body.ref);
    return { ref: body.ref, commit };
  });

  app.post('/mcp/context-pack', async (request) => {
    const body = request.body as { ref?: string; paths?: string[]; limit?: number; maxTokens?: number };
    const pack = await indexManager.buildContextPack(spec, {
      ref: body.ref,
      paths: body.paths,
      limit: body.limit,
      maxTokens: body.maxTokens,
      indexOptions,
    });
    return pack;
  });

  app.get('/recommendations', async (request) => {
    const query = request.query as { limit?: string; maxTokens?: string; ref?: string };
    let index = indexManager.getIndex(spec, query.ref ?? indexOptions?.ref);
    if (!index) {
      index = await indexManager.indexRepository(spec, {
        ...indexOptions,
        ref: query.ref ?? indexOptions?.ref,
        dryRun: true,
      });
    }
    const recommendations = buildRecommendations(index, {
      limit: query.limit ? Number(query.limit) : undefined,
      maxTokens: query.maxTokens ? Number(query.maxTokens) : undefined,
    });
    return { recommendations };
  });

  app.get('/tests/map', async (request) => {
    const query = request.query as { ref?: string };
    let index = indexManager.getIndex(spec, query.ref ?? indexOptions?.ref);
    if (!index) {
      index = await indexManager.indexRepository(spec, {
        ...indexOptions,
        ref: query.ref ?? indexOptions?.ref,
        dryRun: true,
      });
    }
    return { tests: index.testCoverage ?? {} };
  });

  app.get('/graph/dependencies', async (request) => {
    const query = request.query as { ref?: string };
    let index = indexManager.getIndex(spec, query.ref ?? indexOptions?.ref);
    if (!index) {
      index = await indexManager.indexRepository(spec, {
        ...indexOptions,
        ref: query.ref ?? indexOptions?.ref,
        dryRun: true,
      });
    }
    return { graph: index.dependencyGraph ?? {} };
  });

  app.get('/symbols', async (request) => {
    const query = request.query as { ref?: string };
    let index = indexManager.getIndex(spec, query.ref ?? indexOptions?.ref);
    if (!index) {
      index = await indexManager.indexRepository(spec, {
        ...indexOptions,
        ref: query.ref ?? indexOptions?.ref,
        dryRun: true,
      });
    }
    return { symbols: index.symbolIndex ?? {} };
  });

  app.post('/index', async (request, reply) => {
    const body = request.body as { ref?: string; incremental?: boolean } | undefined;
    const optionsForRun: IndexOptions = {
      ...indexOptions,
      ref: body?.ref ?? indexOptions?.ref,
    };
    if (body?.incremental !== undefined) {
      optionsForRun.incremental = body.incremental;
    }
    const started = performance.now();
    const result = await withSpan(
      'repo-tokenizer.index.server',
      {
        'repo.tokenizer.repository_type': spec.type,
        'repo.tokenizer.incremental': Boolean(optionsForRun.incremental),
      },
      () => indexManager.indexRepository(spec, optionsForRun),
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
      repositoryType: spec.type,
    };
    recordIndexMetrics(metrics);
    app.applyBootstrap(result);
    if (notifier) {
      await notifier.notify({
        specPath: spec.path,
        ref: result.ref,
        files: result.files.length,
        chunks: result.chunks.length,
        createdAt: result.createdAt,
      });
    }
    reply.status(202);
    log.info('Indexing run completed', {
      repository: spec.path,
      files: metrics.files,
      chunks: metrics.chunks,
      secrets: metrics.secrets,
      durationMs: metrics.durationMs,
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
  });

  app.post('/pull-request', async (request) => {
    const body = request.body as {
      provider?: string;
      id?: number;
      comment?: boolean;
      status?: boolean;
      failOnSecrets?: boolean;
      statusContext?: string;
      statusTargetUrl?: string;
      commentTemplate?: string;
    };

    if (typeof body.id !== 'number') {
      throw new Error('Missing numeric "id" in request body');
    }
    const provider = normalizeProviderKind(body.provider ?? integrations?.pullRequests?.defaultProvider);
    if (!provider) {
      throw new Error('Pull request provider not specified or unsupported');
    }

    const providerConfigs: PullRequestIndexOptions['providers'] = {
      github: integrations?.github,
      gitlab: integrations?.gitlab,
    };
    if (provider === 'github' && !providerConfigs.github) {
      throw new Error('GitHub integration is not configured on the server');
    }
    if (provider === 'gitlab' && !providerConfigs.gitlab) {
      throw new Error('GitLab integration is not configured on the server');
    }

    const workflow = integrations?.pullRequests;
    const commentEnabled = typeof body.comment === 'boolean' ? body.comment : Boolean(workflow?.autoComment);
    const statusEnabled = typeof body.status === 'boolean' ? body.status : Boolean(workflow?.autoStatusCheck);
    const failOnSecrets = typeof body.failOnSecrets === 'boolean'
      ? body.failOnSecrets
      : Boolean(workflow?.failOnSecretFindings);
    const statusContext = body.statusContext ?? workflow?.statusContext;
    const statusTargetUrl = body.statusTargetUrl ?? workflow?.statusTargetUrl;
    const template = body.commentTemplate ?? workflow?.commentTemplate;

    const identifier: PullRequestIdentifier = { provider, id: body.id };
    const prOptions: PullRequestIndexOptions = {
      providers: providerConfigs,
      indexOptions,
      comment: { enabled: commentEnabled, template },
      status: {
        enabled: statusEnabled,
        context: statusContext,
        targetUrl: statusTargetUrl,
        failOnSecretFindings: failOnSecrets,
      },
    };

    const started = performance.now();
    const result = await withSpan(
      'repo-tokenizer.index.pull-request',
      {
        'repo.tokenizer.provider': provider,
        'repo.tokenizer.repository_type': spec.type,
      },
      () => indexManager.indexPullRequest(spec, identifier, prOptions),
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
      repositoryType: spec.type,
    };
    recordIndexMetrics(metrics);
    app.applyBootstrap(result.index);
    log.info('Pull request indexed', {
      provider,
      number: result.pullRequest.number,
      files: metrics.files,
      chunks: metrics.chunks,
      secrets: metrics.secrets,
      durationMs: metrics.durationMs,
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
  });

  app.get('/files', async (request) => {
    const query = request.query as { include?: string; exclude?: string; ref?: string };
    const include = query.include ? query.include.split(',') : undefined;
    const exclude = query.exclude ? query.exclude.split(',') : undefined;
    const files = indexManager.listFiles(spec, { ref: query.ref, include, exclude });
    return { files };
  });

  app.get('/file', async (request) => {
    const query = request.query as { path?: string; ref?: string };
    if (!query.path) {
      throw new Error('Missing path parameter');
    }
    const file = indexManager.getFile(spec, query.path, query.ref);
    return { file };
  });

  app.get('/chunks', async (request, reply) => {
    const query = request.query as { path?: string; lang?: string; maxTokens?: string; stream?: string; ref?: string };
    const chunks = indexManager.listChunks(spec, {
      ref: query.ref,
      path: query.path,
      lang: query.lang,
      maxTokens: query.maxTokens ? Number(query.maxTokens) : undefined,
    });

    if (query.stream === 'true') {
      reply.header('Content-Type', 'application/x-ndjson');
      reply.header('Transfer-Encoding', 'chunked');
      for (const chunk of chunks) {
        if (!reply.raw.write(`${JSON.stringify(chunk)}\n`)) {
          await once(reply.raw, 'drain');
        }
      }
      reply.raw.end();
      return reply;
    }

    return { chunks };
  });

  app.get('/chunks/:id', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { ref?: string };
    const chunk = indexManager.getChunk(spec, params.id, query.ref);
    return { chunk };
  });

  app.get('/search', async (request) => {
    const query = request.query as { q: string; pathGlob?: string; ref?: string };
    if (!query.q) {
      throw new Error('Missing q parameter');
    }
    const matches = indexManager.searchText(spec, query.q, {
      ref: query.ref,
      pathGlob: query.pathGlob,
    });
    return { matches };
  });

  app.get('/search/symbols', async (request) => {
    const query = request.query as { q?: string; ref?: string };
    const matches = indexManager.searchSymbols(spec, query.q, { ref: query.ref });
    return { matches };
  });

  app.get('/export/jsonl', async (request, reply) => {
    const query = request.query as { ref?: string };
    const index = indexManager.getIndex(spec, query.ref);
    if (!index) {
      throw new Error('Index not found');
    }
    reply.header('Content-Type', 'application/x-ndjson');
    await exportIndexToJsonl(index, reply.raw);
    reply.raw.end();
    return reply;
  });

  app.get('/export/sqlite', async (request, reply) => {
    const query = request.query as { ref?: string };
    const index = indexManager.getIndex(spec, query.ref);
    if (!index) {
      throw new Error('Index not found');
    }
    const buffer = await buildSqliteBuffer(index);
    reply.header('Content-Type', 'application/vnd.sqlite3');
    reply.header('Content-Disposition', 'attachment; filename="index.sqlite"');
    reply.send(buffer);
  });

  return app;
}

function normalizeProviderKind(value?: string): GitProviderKind | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'github' || normalized === 'gitlab') {
    return normalized as GitProviderKind;
  }
  return undefined;
}
