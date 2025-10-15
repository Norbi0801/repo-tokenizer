import Fastify, { FastifyInstance } from 'fastify';
import { IndexManager } from '../indexer';
import { RepositorySpec } from '../ingest';
import { IndexOptions } from '../indexer/types';
import { exportIndexToJsonl } from '../exporters/jsonl';
import { buildSqliteBuffer } from '../exporters/sqlite';
import { IndexNotifier, NotifierOptions } from './notifier';
import { once } from 'node:events';

interface ServerOptions {
  spec: RepositorySpec;
  indexOptions?: IndexOptions;
  notifier?: NotifierOptions;
}

export function createServer(indexManager: IndexManager, options: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: true });
  const { spec, indexOptions } = options;
  const notifier = new IndexNotifier(options.notifier);

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/index', async (request, reply) => {
    const body = request.body as { ref?: string } | undefined;
    const result = await indexManager.indexRepository(spec, { ...indexOptions, ref: body?.ref ?? indexOptions?.ref });
    await notifier.notify({
      specPath: spec.path,
      ref: result.ref,
      files: result.files.length,
      chunks: result.chunks.length,
      createdAt: result.createdAt,
    });
    reply.status(202);
    return {
      message: 'indexing complete',
      files: result.files.length,
      chunks: result.chunks.length,
      ref: result.ref,
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
