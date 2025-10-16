import { IndexResult } from '../indexer/types';

export interface DeltaSnapshot {
  baseRef?: string;
  headRef?: string;
  addedChunks: string[];
  removedChunks: string[];
  changedFiles: string[];
  timestamp: string;
}

export function buildDeltaSnapshot(base: IndexResult | undefined, head: IndexResult): DeltaSnapshot {
  const baseChunks = base ? new Set(base.chunks.map((chunk) => chunk.id)) : new Set<string>();
  const headChunks = new Set(head.chunks.map((chunk) => chunk.id));

  const added: string[] = [];
  const removed: string[] = [];

  headChunks.forEach((id) => {
    if (!baseChunks.has(id)) {
      added.push(id);
    }
  });

  baseChunks.forEach((id) => {
    if (!headChunks.has(id)) {
      removed.push(id);
    }
  });

  const changedFiles: string[] = [];
  if (base) {
    const baseMap = new Map(base.files.map((file) => [file.path, file]));
    head.files.forEach((file) => {
      const previous = baseMap.get(file.path);
      if (!previous) {
        changedFiles.push(file.path);
      } else if (previous.hash !== file.hash) {
        changedFiles.push(file.path);
      }
    });
  } else {
    head.files.forEach((file) => changedFiles.push(file.path));
  }

  changedFiles.sort();

  return {
    baseRef: base?.ref,
    headRef: head.ref,
    addedChunks: added,
    removedChunks: removed,
    changedFiles,
    timestamp: new Date().toISOString(),
  };
}
