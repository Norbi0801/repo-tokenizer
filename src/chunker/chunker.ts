import { createHash } from 'node:crypto';
import { AdaptiveChunkingOptions, Chunk, ChunkingInput, ChunkingOptions, ChunkMetadata, Tokenizer } from './types';

interface DraftChunk {
  text: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  charCount: number;
}

interface LineInfo {
  text: string;
  lineNumber: number;
}

const DEFAULT_LINES_PER_CHUNK = 200;
const DEFAULT_TOKENS_PER_CHUNK = 400;
const DEFAULT_SLIDING_WINDOW_STEP = 100;

export class Chunker {
  generate(input: ChunkingInput, options: ChunkingOptions): Chunk[] {
    const lines = this.splitLines(input.text);
    const drafts = this.buildDrafts(input, options, lines);
    return this.finalizeDrafts(drafts, input, options);
  }

  private buildDrafts(
    input: ChunkingInput,
    options: ChunkingOptions,
    lines: LineInfo[],
  ): DraftChunk[] {
    const normalizedOptions = this.normalizeOptions(options);
    const initial = this.runStrategy(input, normalizedOptions, lines);
    return this.applyAdaptive(initial, normalizedOptions, lines, input, normalizedOptions.tokenizer);
  }

  private runStrategy(
    input: ChunkingInput,
    options: ChunkingOptions,
    lines: LineInfo[],
  ): DraftChunk[] {
    switch (options.strategy) {
      case 'lines':
        return this.chunkByLines(lines, options, input, options.tokenizer);
      case 'tokens':
        return this.chunkByTokens(input, options);
      case 'sliding-window':
        return this.chunkBySlidingWindow(input, options, lines);
      case 'by-section':
        return this.chunkBySections(lines, options, input);
      default:
        throw new Error(`Unsupported chunking strategy: ${String(options.strategy)}`);
    }
  }

  private chunkByLines(
    lines: LineInfo[],
    options: ChunkingOptions,
    input: ChunkingInput,
    tokenizer: Tokenizer,
  ): DraftChunk[] {
    const targetLines =
      options.targetLines ??
      options.maxLines ??
      options.adaptive?.maxChunkSizeLines ??
      DEFAULT_LINES_PER_CHUNK;
    const overlap = Math.max(0, options.overlap ?? 0);
    const step = Math.max(1, targetLines - overlap);
    const results: DraftChunk[] = [];

    for (let i = 0; i < lines.length; i += step) {
      const slice = lines.slice(i, Math.min(i + targetLines, lines.length));
      if (slice.length === 0) {
        continue;
      }
      const text = slice.map((line) => line.text).join('\n');
      const startLine = slice[0].lineNumber;
      const endLine = slice[slice.length - 1].lineNumber;
      const tokenCount = tokenizer.count(text);
      results.push({
        text,
        startLine,
        endLine,
        tokenCount,
        charCount: text.length,
      });
    }
    return results;
  }

  private chunkByTokens(input: ChunkingInput, options: ChunkingOptions): DraftChunk[] {
    const tokenizer = options.tokenizer;
    const targetTokens = options.targetChunkSizeTokens ?? DEFAULT_TOKENS_PER_CHUNK;
    const overlap = Math.max(0, options.overlap ?? 0);

    const encoded = tokenizer.encode?.(input.text);
    const tokenCount = encoded?.count ?? tokenizer.count(input.text);
    if (!encoded || !encoded.offsets) {
      return this.chunkByCharsApproximation(input, tokenCount, targetTokens, overlap, tokenizer);
    }

    const offsets = encoded.offsets;
    const results: DraftChunk[] = [];
    const tokens = encoded.tokens;
    const step = Math.max(1, targetTokens - overlap);

    for (let start = 0; start < tokens.length; start += step) {
      const end = Math.min(start + targetTokens, tokens.length);
      const startOffset = offsets[start]?.start ?? 0;
      const endOffset = offsets[end - 1]?.end ?? input.text.length;
      const text = input.text.slice(startOffset, endOffset);
      const chunkTokenCount = end - start;
      const { startLine, endLine } = this.computeLineRange(input.text, startOffset, endOffset);
      results.push({
        text,
        startLine,
        endLine,
        tokenCount: chunkTokenCount,
        charCount: text.length,
      });
    }
    return results;
  }

  private chunkBySlidingWindow(
    input: ChunkingInput,
    options: ChunkingOptions,
    lines: LineInfo[],
  ): DraftChunk[] {
    const tokenizer = options.tokenizer;
    const windowOptions = options.slidingWindow ?? {};
    const windowTokens = windowOptions.windowSizeTokens ?? DEFAULT_TOKENS_PER_CHUNK;
    const stepTokens = windowOptions.stepTokens ?? DEFAULT_SLIDING_WINDOW_STEP;
    const encoded = tokenizer.encode?.(input.text);
    const tokenCount = encoded?.count ?? tokenizer.count(input.text);

    if (!encoded || !encoded.offsets) {
      return this.chunkBySlidingWindowApprox(input, tokenCount, windowTokens, stepTokens);
    }

    const results: DraftChunk[] = [];
    for (let start = 0; start < tokenCount; start += stepTokens) {
      const end = Math.min(start + windowTokens, tokenCount);
      if (end - start <= 0) {
        break;
      }
      const startOffset = encoded.offsets[start]?.start ?? 0;
      const endOffset = encoded.offsets[end - 1]?.end ?? input.text.length;
      const text = input.text.slice(startOffset, endOffset);
      const { startLine, endLine } = this.computeLineRange(input.text, startOffset, endOffset);
      results.push({
        text,
        startLine,
        endLine,
        tokenCount: end - start,
        charCount: text.length,
      });
      if (end === tokenCount) {
        break;
      }
    }
    return results;
  }

  private chunkBySections(
    lines: LineInfo[],
    options: ChunkingOptions,
    input: ChunkingInput,
  ): DraftChunk[] {
    const tokenizer = options.tokenizer;
    const patterns =
      options.sectionHeuristics?.headingPatterns ??
      defaultSectionPatterns(input.language ?? 'plaintext');

    const results: DraftChunk[] = [];
    let startIndex = 0;

    for (let i = 1; i < lines.length; i += 1) {
      if (patterns.some((pattern) => pattern.test(lines[i].text))) {
        if (i - startIndex > 0) {
          this.pushSectionChunk(lines, startIndex, i, tokenizer, results);
        }
        startIndex = i;
      }
    }

    if (startIndex < lines.length) {
      this.pushSectionChunk(lines, startIndex, lines.length, tokenizer, results);
    }

    return results;
  }

  private pushSectionChunk(
    lines: LineInfo[],
    start: number,
    end: number,
    tokenizer: Tokenizer,
    results: DraftChunk[],
  ) {
    const slice = lines.slice(start, end);
    if (slice.length === 0) {
      return;
    }
    const text = slice.map((line) => line.text).join('\n');
    const startLine = slice[0].lineNumber;
    const endLine = slice[slice.length - 1].lineNumber;
    results.push({
      text,
      startLine,
      endLine,
      tokenCount: tokenizer.count(text),
      charCount: text.length,
    });
  }

  private chunkByCharsApproximation(
    input: ChunkingInput,
    totalTokens: number,
    targetTokens: number,
    overlap: number,
    tokenizer: Tokenizer,
  ): DraftChunk[] {
    const tokensPerChar = totalTokens > 0 ? totalTokens / Math.max(1, input.text.length) : 1;
    const approxChars = Math.max(1, Math.floor(targetTokens / tokensPerChar));
    const stepChars = Math.max(1, approxChars - Math.floor(overlap / Math.max(1, tokensPerChar)));
    const results: DraftChunk[] = [];

    for (let start = 0; start < input.text.length; start += stepChars) {
      const end = Math.min(start + approxChars, input.text.length);
      if (end <= start) {
        break;
      }
      const text = input.text.slice(start, end);
      const { startLine, endLine } = this.computeLineRange(input.text, start, end);
      results.push({
        text,
        startLine,
        endLine,
        tokenCount: tokenizer.count(text),
        charCount: text.length,
      });
      if (end === input.text.length) {
        break;
      }
    }
    return results;
  }

  private chunkBySlidingWindowApprox(
    input: ChunkingInput,
    totalTokens: number,
    windowTokens: number,
    stepTokens: number,
  ): DraftChunk[] {
    const tokensPerChar = totalTokens > 0 ? totalTokens / Math.max(1, input.text.length) : 1;
    const windowChars = Math.max(1, Math.floor(windowTokens / tokensPerChar));
    const stepChars = Math.max(1, Math.floor(stepTokens / tokensPerChar));
    const results: DraftChunk[] = [];

    for (let start = 0; start < input.text.length; start += stepChars) {
      const end = Math.min(start + windowChars, input.text.length);
      if (end <= start) {
        break;
      }
      const text = input.text.slice(start, end);
      const { startLine, endLine } = this.computeLineRange(input.text, start, end);
      results.push({
        text,
        startLine,
        endLine,
        tokenCount: Math.ceil((end - start) * tokensPerChar),
        charCount: text.length,
      });
      if (end === input.text.length) {
        break;
      }
    }
    return results;
  }

  private applyAdaptive(
    drafts: DraftChunk[],
    options: ChunkingOptions,
    lines: LineInfo[],
    input: ChunkingInput,
    tokenizer: Tokenizer,
  ): DraftChunk[] {
    const adaptive = options.adaptive;
    let processed = drafts;
    if (adaptive?.mergeSmallAdjacent) {
      processed = this.mergeSmallChunks(processed, adaptive, tokenizer);
    }
    if (adaptive?.splitLargeChunks) {
      processed = this.splitLargeChunks(processed, adaptive, lines, tokenizer, input);
    }
    processed = this.enforceBudget(processed, options, lines, tokenizer, input);
    return processed;
  }

  private mergeSmallChunks(
    chunks: DraftChunk[],
    adaptive: AdaptiveChunkingOptions,
    tokenizer: Tokenizer,
  ): DraftChunk[] {
    const minTokens = adaptive.minChunkSizeTokens ?? 0;
    const minChars = adaptive.minChunkSizeChars ?? 0;
    const minLines = adaptive.minChunkSizeLines ?? 0;

    if (chunks.length <= 1) {
      return chunks;
    }

    const merged: DraftChunk[] = [];
    let buffer: DraftChunk | undefined;

    for (const chunk of chunks) {
      if (!buffer) {
        buffer = { ...chunk };
        continue;
      }

      const bufferedLines = buffer.endLine - buffer.startLine + 1;
      const meetsSize =
        buffer.tokenCount >= minTokens &&
        buffer.charCount >= minChars &&
        bufferedLines >= minLines;

      if (meetsSize) {
        merged.push(buffer);
        buffer = { ...chunk };
      } else {
        const text = `${buffer.text}\n${chunk.text}`;
        buffer = {
          text,
          startLine: buffer.startLine,
          endLine: chunk.endLine,
          charCount: text.length,
          tokenCount: tokenizer.count(text),
        };
      }
    }

    if (buffer) {
      merged.push(buffer);
    }

    return merged;
  }

  private splitLargeChunks(
    chunks: DraftChunk[],
    adaptive: AdaptiveChunkingOptions,
    lines: LineInfo[],
    tokenizer: Tokenizer,
    input: ChunkingInput,
  ): DraftChunk[] {
    const maxTokens = adaptive.maxChunkSizeTokens ?? Infinity;
    const maxChars = adaptive.maxChunkSizeChars ?? Infinity;
    const maxLines = adaptive.maxChunkSizeLines ?? Infinity;

    const results: DraftChunk[] = [];
    const queue: DraftChunk[] = [...chunks];

    while (queue.length > 0) {
      const chunk = queue.shift()!;
      const chunkLines = chunk.endLine - chunk.startLine + 1;
      if (
        chunk.tokenCount <= maxTokens &&
        chunk.charCount <= maxChars &&
        chunkLines <= maxLines
      ) {
        results.push(chunk);
        continue;
      }

      const pieces = this.divideChunk(chunk, adaptive, lines, tokenizer, input);
      if (pieces.length === 1 && pieces[0] === chunk) {
        results.push(chunk);
        continue;
      }
      queue.unshift(...pieces);
    }
    return results;
  }

  private finalizeDrafts(
    drafts: DraftChunk[],
    input: ChunkingInput,
    options: ChunkingOptions,
  ): Chunk[] {
    const sorted = drafts
      .slice()
      .sort((a, b) => a.startLine - b.startLine || a.tokenCount - b.tokenCount);

    const totalChunks = sorted.length;
    return sorted.map((draft, index) => {
      const metadata: ChunkMetadata = {
        origin: 'file',
        path: input.path,
        startLine: draft.startLine,
        endLine: draft.endLine,
        tokenCount: draft.tokenCount,
        charCount: draft.charCount,
        chunkIndex: index,
        totalChunks,
      };
      const id = this.computeChunkId(input.path, draft, options);
      return {
        id,
        text: draft.text,
        metadata,
      };
    });
  }

  private computeChunkId(path: string, draft: DraftChunk, options: ChunkingOptions): string {
    const hash = createHash('sha256');
    hash.update(path);
    hash.update(String(draft.startLine));
    hash.update(String(draft.endLine));
    hash.update(draft.text);
    if (options.tokenizer?.id) {
      hash.update(options.tokenizer.id);
    }
    return hash.digest('hex');
  }

  private splitLines(text: string): LineInfo[] {
    const raw = text.split(/\r?\n/);
    return raw.map((line, index) => ({
      text: line,
      lineNumber: index + 1,
    }));
  }

  private computeLineRange(
    fullText: string,
    startOffset: number,
    endOffset: number,
  ): { startLine: number; endLine: number } {
    const leading = fullText.slice(0, startOffset);
    const between = fullText.slice(startOffset, endOffset);
    const startLine = leading.split(/\r?\n/).length;
    const endLine = startLine + between.split(/\r?\n/).length - 1;
    return { startLine, endLine };
  }

  private normalizeOptions(options: ChunkingOptions): ChunkingOptions {
    const budget = options.contextBudgetTokens;
    if (!budget) {
      return options;
    }
    const normalized: ChunkingOptions = {
      ...options,
      targetChunkSizeTokens: Math.min(options.targetChunkSizeTokens ?? DEFAULT_TOKENS_PER_CHUNK, budget),
      maxTokens: Math.min(options.maxTokens ?? budget, budget),
      slidingWindow: options.slidingWindow
        ? {
            ...options.slidingWindow,
            windowSizeTokens: Math.min(
              options.slidingWindow.windowSizeTokens ?? DEFAULT_TOKENS_PER_CHUNK,
              budget,
            ),
            stepTokens: Math.min(
              options.slidingWindow.stepTokens ?? DEFAULT_SLIDING_WINDOW_STEP,
              budget,
            ),
          }
        : undefined,
    };
    return normalized;
  }

  private enforceBudget(
    chunks: DraftChunk[],
    options: ChunkingOptions,
    lines: LineInfo[],
    tokenizer: Tokenizer,
    input: ChunkingInput,
  ): DraftChunk[] {
    const limitTokens = options.maxTokens ?? options.contextBudgetTokens;
    if (!limitTokens) {
      return chunks;
    }

    return this.splitLargeChunks(
      chunks,
      {
        maxChunkSizeTokens: limitTokens,
        maxChunkSizeChars: options.maxChars,
        maxChunkSizeLines: options.maxLines,
      },
      lines,
      tokenizer,
      input,
    );
  }

  private divideChunk(
    chunk: DraftChunk,
    adaptive: AdaptiveChunkingOptions,
    lines: LineInfo[],
    tokenizer: Tokenizer,
    input: ChunkingInput,
  ): DraftChunk[] {
    const subset = lines.slice(chunk.startLine - 1, chunk.endLine);
    const chunkLines = subset.length;
    if (chunkLines === 0) {
      return [chunk];
    }

    const avgTokensPerLine = chunk.tokenCount / Math.max(1, chunkLines);
    let targetLines = chunkLines;

    const maxTokensValue = adaptive.maxChunkSizeTokens;
    if (typeof maxTokensValue === 'number' && Number.isFinite(maxTokensValue)) {
      const estimatedLines = Math.max(
        1,
        Math.floor(maxTokensValue / Math.max(1, avgTokensPerLine)),
      );
      targetLines = Math.min(targetLines, estimatedLines);
    }
    if (
      typeof adaptive.maxChunkSizeLines === 'number' &&
      Number.isFinite(adaptive.maxChunkSizeLines)
    ) {
      targetLines = Math.min(targetLines, adaptive.maxChunkSizeLines ?? targetLines);
    }
    if (targetLines < chunkLines) {
      const pieces = this.chunkByLines(
        subset,
        { ...optionsBaseline(tokenizer), targetLines },
        input,
        tokenizer,
      );
      if (pieces.length > 1) {
        return pieces;
      }
    }

    return this.splitChunkEvenlyByLines(chunk, subset, adaptive, tokenizer);
  }

  private splitChunkEvenlyByLines(
    chunk: DraftChunk,
    subset: LineInfo[],
    adaptive: AdaptiveChunkingOptions,
    tokenizer: Tokenizer,
  ): DraftChunk[] {
    const limitTokens = adaptive.maxChunkSizeTokens ?? Infinity;
    if (!(typeof limitTokens === 'number') || !Number.isFinite(limitTokens)) {
      return [chunk];
    }

    const segments = Math.max(2, Math.ceil(chunk.tokenCount / limitTokens));
    const perSegment = Math.max(1, Math.floor(subset.length / segments));
    const pieces: DraftChunk[] = [];

    let index = 0;
    for (let segment = 0; segment < segments && index < subset.length; segment += 1) {
      const remainingSegments = segments - segment;
      const remainingLines = subset.length - index;
      const sliceLength =
        segment === segments - 1 ? remainingLines : Math.min(perSegment, remainingLines - (remainingSegments - 1));
      const slice = subset.slice(index, index + sliceLength);
      index += sliceLength;

      const text = slice.map((line) => line.text).join('\n');
      pieces.push({
        text,
        startLine: slice[0].lineNumber,
        endLine: slice[slice.length - 1].lineNumber,
        tokenCount: tokenizer.count(text),
        charCount: text.length,
      });
    }

    return pieces.length > 0 ? pieces : [chunk];
  }
}

function defaultSectionPatterns(language: string): RegExp[] {
  const patterns = [
    /^#{1,6}\s+/,
    /^\/\/\s*#?region\b/i,
    /^function\s+\w+/,
    /^class\s+\w+/,
    /^\w+\s*=\s*function\b/,
    /^interface\s+\w+/,
    /^def\s+\w+/,
    /^it\(/,
    /^describe\(/,
  ];
  if (language === 'markdown') {
    patterns.push(/^\s*-\s+/);
  }
  return patterns;
}

function optionsBaseline(tokenizer: Tokenizer): ChunkingOptions {
  return {
    strategy: 'lines',
    tokenizer,
    targetLines: DEFAULT_LINES_PER_CHUNK,
  };
}
