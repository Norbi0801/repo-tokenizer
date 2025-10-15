import { Writable } from 'node:stream';
import { once } from 'node:events';
import { IndexResult } from '../indexer';

async function writeLine(stream: Writable, line: string) {
  if (!stream.write(`${line}\n`)) {
    await once(stream, 'drain');
  }
}

export async function exportIndexToJsonl(result: IndexResult, stream: Writable): Promise<void> {
  for (const file of result.files) {
    await writeLine(stream, JSON.stringify({ type: 'file', data: file }));
  }
  for (const chunk of result.chunks) {
    await writeLine(stream, JSON.stringify({ type: 'chunk', data: chunk }));
  }
  for (const finding of result.secretFindings) {
    await writeLine(stream, JSON.stringify({ type: 'secret_finding', data: finding }));
  }
}
