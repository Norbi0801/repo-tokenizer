import { writeFile } from 'node:fs/promises';
import initSqlJs, { Database } from 'sql.js';
import { IndexResult } from '../indexer';

function createSchema(db: Database) {
  db.run(`
    CREATE TABLE files (
      path TEXT PRIMARY KEY,
      size INTEGER,
      hash TEXT,
      language TEXT,
      executable INTEGER
    );
  `);

  db.run(`
    CREATE TABLE chunks (
      id TEXT PRIMARY KEY,
      path TEXT,
      start_line INTEGER,
      end_line INTEGER,
      token_count INTEGER,
      char_count INTEGER,
      chunk_index INTEGER,
      total_chunks INTEGER,
      text TEXT,
      file_hash TEXT
    );
  `);

  db.run('CREATE INDEX idx_chunks_path ON chunks(path);');
  db.run('CREATE INDEX idx_chunks_file_hash ON chunks(file_hash);');

  db.run(`
    CREATE TABLE secret_findings (
      path TEXT,
      line INTEGER,
      rule_id TEXT,
      excerpt TEXT
    );
  `);
}

export async function buildSqliteBuffer(result: IndexResult): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  try {
    createSchema(db);
    const insertFile = db.prepare(
      'INSERT INTO files(path, size, hash, language, executable) VALUES (?, ?, ?, ?, ?)',
    );
    const insertChunk = db.prepare(
      'INSERT INTO chunks(id, path, start_line, end_line, token_count, char_count, chunk_index, total_chunks, text, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const insertSecret = db.prepare(
      'INSERT INTO secret_findings(path, line, rule_id, excerpt) VALUES (?, ?, ?, ?)',
    );

    for (const file of result.files) {
      insertFile.run([
        file.path,
        file.size,
        file.hash,
        file.language ?? null,
        file.executable ? 1 : 0,
      ]);
    }
    insertFile.free();

    for (const chunk of result.chunks) {
      insertChunk.run([
        chunk.id,
        chunk.metadata.path,
        chunk.metadata.startLine,
        chunk.metadata.endLine,
        chunk.metadata.tokenCount,
        chunk.metadata.charCount,
        chunk.metadata.chunkIndex,
        chunk.metadata.totalChunks,
        chunk.text,
        chunk.fileHash,
      ]);
    }
    insertChunk.free();

    for (const finding of result.secretFindings) {
      insertSecret.run([
        finding.path,
        finding.line,
        finding.ruleId,
        finding.excerpt,
      ]);
    }
    insertSecret.free();

    const binary = db.export();
    return Buffer.from(binary);
  } finally {
    db.close();
  }
}

export async function exportIndexToSqlite(result: IndexResult, outputPath: string): Promise<void> {
  const buffer = await buildSqliteBuffer(result);
  await writeFile(outputPath, buffer);
}
