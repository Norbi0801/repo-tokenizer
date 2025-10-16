import { writeFile } from 'node:fs/promises';
import { IndexResult } from '../indexer/types';

export type VectorTarget = 'faiss' | 'qdrant' | 'pgvector';

export interface VectorExportOptions {
  target: VectorTarget;
  dimension?: number;
  collection?: string;
  tableName?: string;
}

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

function generateEmbedding(text: string, dimension: number): number[] {
  const vector = new Array<number>(dimension).fill(0);
  for (let i = 0; i < text.length; i += 1) {
    const charCode = text.charCodeAt(i);
    vector[i % dimension] += charCode / 255;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

export function buildVectorRecords(index: IndexResult, dimension = 64): VectorRecord[] {
  return index.chunks.map((chunk) => ({
    id: chunk.id,
    vector: generateEmbedding(chunk.text, dimension),
    metadata: {
      path: chunk.metadata.path,
      startLine: chunk.metadata.startLine,
      endLine: chunk.metadata.endLine,
      tokenCount: chunk.metadata.tokenCount,
      fileHash: chunk.fileHash,
    },
  }));
}

export async function exportVectors(index: IndexResult, options: VectorExportOptions, filePath: string): Promise<void> {
  const dimension = options.dimension ?? 64;
  const records = buildVectorRecords(index, dimension);

  switch (options.target) {
    case 'faiss': {
      const payload = {
        dimension,
        vectors: records.map((record) => ({ id: record.id, vector: record.vector })),
        metadata: records.map((record) => ({ id: record.id, ...record.metadata })),
      };
      await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
      break;
    }
    case 'qdrant': {
      const collection = options.collection ?? 'repo-tokenizer';
      const payload = {
        collection,
        vectors: records.map((record) => ({
          id: record.id,
          vector: record.vector,
          payload: record.metadata,
        })),
      };
      await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
      break;
    }
    case 'pgvector': {
      const table = options.tableName ?? 'repo_embeddings';
      const rows = records
        .map((record) => {
          const safePath = String(record.metadata.path ?? '').replace(/'/g, "''");
          return `('${record.id}', '[${record.vector.join(',')}]', '${safePath}', ${record.metadata.startLine}, ${record.metadata.endLine})`;
        })
        .join(',\n');
      const sql = `CREATE TABLE IF NOT EXISTS ${table} (
  chunk_id TEXT PRIMARY KEY,
  embedding vector(${dimension}),
  path TEXT,
  start_line INT,
  end_line INT
);

INSERT INTO ${table} (chunk_id, embedding, path, start_line, end_line)
VALUES
${rows};
`;
      await writeFile(filePath, sql, 'utf8');
      break;
    }
    default:
      throw new Error(`Unsupported vector target: ${options.target}`);
  }
}
