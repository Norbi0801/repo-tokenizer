import { PassThrough } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { IndexResult } from '../indexer/types';
import { ParquetSchema, ParquetWriter } from 'parquetjs-lite';

const CHUNK_SCHEMA = new ParquetSchema({
  chunk_id: { type: 'UTF8' },
  path: { type: 'UTF8' },
  text: { type: 'UTF8' },
  start_line: { type: 'INT64' },
  end_line: { type: 'INT64' },
  token_count: { type: 'INT64', optional: true },
  language: { type: 'UTF8', optional: true },
});

export async function exportIndexToParquet(index: IndexResult, filePath: string): Promise<void> {
  const writer = await ParquetWriter.openFile(CHUNK_SCHEMA, filePath);
  try {
    for (const chunk of index.chunks) {
      await writer.appendRow({
        chunk_id: chunk.id,
        path: chunk.metadata.path,
        text: chunk.text,
        start_line: chunk.metadata.startLine,
        end_line: chunk.metadata.endLine,
        token_count: chunk.metadata.tokenCount ?? null,
        language: index.fileLanguageByHash[chunk.fileHash] ?? null,
      });
    }
  } finally {
    await writer.close();
  }
}

export async function buildParquetBuffer(index: IndexResult): Promise<Buffer> {
  const stream = new PassThrough();
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));

  const writer = await ParquetWriter.openStream(CHUNK_SCHEMA, stream);
  try {
    for (const chunk of index.chunks) {
      await writer.appendRow({
        chunk_id: chunk.id,
        path: chunk.metadata.path,
        text: chunk.text,
        start_line: chunk.metadata.startLine,
        end_line: chunk.metadata.endLine,
        token_count: chunk.metadata.tokenCount ?? null,
        language: index.fileLanguageByHash[chunk.fileHash] ?? null,
      });
    }
  } finally {
    await writer.close();
  }
  stream.end();
  return Buffer.concat(chunks);
}

export async function exportIndexToParquetBuffer(index: IndexResult, filePath: string): Promise<void> {
  const buffer = await buildParquetBuffer(index);
  await writeFile(filePath, buffer);
}
