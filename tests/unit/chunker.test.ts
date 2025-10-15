import { describe, it, expect } from 'vitest';
import { Chunker } from '../../src/chunker/chunker';
import { BasicTokenizer } from '../../src/chunker/tokenizers/basic';
import { Tokenizer } from '../../src/chunker/types';

const tokenizer: Tokenizer = new BasicTokenizer();

function sampleText(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, index) => `line ${index + 1}`).join('\n');
}

describe('Chunker', () => {
  it('chunks by lines with overlap', () => {
    const chunker = new Chunker();
    const text = sampleText(30);
    const chunks = chunker.generate(
      { text, path: 'example.txt' },
      {
        strategy: 'lines',
        tokenizer,
        targetLines: 10,
        overlap: 2,
      },
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[0].metadata.endLine).toBe(10);
    if (chunks.length > 1) {
      expect(chunks[1].metadata.startLine).toBe(9);
    }
  });

  it('chunks by tokens respecting target size', () => {
    const chunker = new Chunker();
    const text = sampleText(120);
    const targetTokens = 80;
    const chunks = chunker.generate(
      { text, path: 'tokens.txt' },
      {
        strategy: 'tokens',
        tokenizer,
        targetChunkSizeTokens: targetTokens,
        overlap: 10,
      },
    );

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.metadata.tokenCount).toBeLessThanOrEqual(targetTokens + 10);
    }
  });

  it('produces sliding window chunks', () => {
    const chunker = new Chunker();
    const text = sampleText(60);
    const chunks = chunker.generate(
      { text, path: 'window.txt' },
      {
        strategy: 'sliding-window',
        tokenizer,
        slidingWindow: {
          windowSizeTokens: 50,
          stepTokens: 25,
        },
      },
    );

    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[1].metadata.startLine).toBeLessThan(chunks[1].metadata.endLine);
  });

  it('detects sections and splits accordingly', () => {
    const chunker = new Chunker();
    const text = [
      '# Heading 1',
      'content a',
      'content b',
      '# Heading 2',
      'content c',
      'content d',
    ].join('\n');

    const chunks = chunker.generate(
      { text, path: 'sections.md', language: 'markdown' },
      {
        strategy: 'by-section',
        tokenizer,
      },
    );

    expect(chunks.length).toBe(2);
    expect(chunks[0].metadata.startLine).toBe(1);
    expect(chunks[1].metadata.startLine).toBe(4);
  });

  it('merges small chunks and splits large ones adaptively', () => {
    const chunker = new Chunker();
    const text = sampleText(20);

    const chunks = chunker.generate(
      { text, path: 'adaptive.txt' },
      {
        strategy: 'lines',
        tokenizer,
        targetLines: 3,
        adaptive: {
          mergeSmallAdjacent: true,
          minChunkSizeLines: 4,
          splitLargeChunks: true,
          maxChunkSizeLines: 6,
        },
      },
    );

    expect(chunks.every((chunk) => chunk.metadata.endLine - chunk.metadata.startLine + 1 <= 6)).toBe(
      true,
    );
    expect(chunks[0].metadata.startLine).toBe(1);
  });

  it('enforces context budget for chunk sizes', () => {
    const chunker = new Chunker();
    const text = sampleText(200);
    const budget = 120;
    const chunks = chunker.generate(
      { text, path: 'budget.txt' },
      {
        strategy: 'tokens',
        tokenizer,
        contextBudgetTokens: budget,
      },
    );

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.metadata.tokenCount <= budget)).toBe(true);
  });

  it('creates stable chunk identifiers', () => {
    const chunker = new Chunker();
    const text = sampleText(20);
    const options = {
      strategy: 'lines' as const,
      tokenizer,
      targetLines: 5,
    };

    const first = chunker.generate({ text, path: 'stable.txt' }, options);
    const second = chunker.generate({ text, path: 'stable.txt' }, options);
    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id));
  });
});
