export interface TokenizerEncodeResult {
  tokens: number[];
  count: number;
  offsets?: Array<{ start: number; end: number }>;
}

export interface Tokenizer {
  readonly id: string;
  readonly version?: string;
  /** Returns number of tokens for the given text. */
  count(text: string): number;
  /** Optional encode to return individual token ids. */
  encode?(text: string): TokenizerEncodeResult;
  /** Approximate decode, optional. */
  decode?(tokens: number[]): string;
  /** Maximum tokens supported per chunk (optional). */
  maxTokens?: number;
}

export interface TokenizerFactory {
  id: string;
  create(): Tokenizer;
  heuristics?: {
    suggestedChunkSize?: number;
  };
}

export type ChunkOrigin = 'file' | 'generated';

export interface ChunkContext {
  filePath: string;
  language?: string;
  section?: string;
}

export interface ChunkMetadata {
  origin: ChunkOrigin;
  path: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  charCount: number;
  chunkIndex: number;
  totalChunks: number;
  section?: string;
}

export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
}

export interface ChunkingOptions {
  strategy: ChunkingStrategyType;
  tokenizer: Tokenizer;
  maxTokens?: number;
  maxChars?: number;
  maxLines?: number;
  targetLines?: number;
  overlap?: number;
  targetChunkSizeTokens?: number;
  targetChunkSizeChars?: number;
  contextBudgetTokens?: number;
  adaptive?: AdaptiveChunkingOptions;
  sectionHeuristics?: SectionHeuristicsOptions;
  slidingWindow?: SlidingWindowOptions;
}

export interface AdaptiveChunkingOptions {
  minChunkSizeTokens?: number;
  minChunkSizeChars?: number;
  minChunkSizeLines?: number;
  maxChunkSizeTokens?: number;
  maxChunkSizeChars?: number;
  maxChunkSizeLines?: number;
  mergeSmallAdjacent?: boolean;
  splitLargeChunks?: boolean;
}

export interface SectionHeuristicsOptions {
  headingPatterns?: RegExp[];
  language?: string;
}

export type ChunkingStrategyType =
  | 'lines'
  | 'tokens'
  | 'sliding-window'
  | 'by-section';

export interface ChunkingInput {
  text: string;
  path: string;
  language?: string;
}

export interface SlidingWindowOptions {
  windowSizeTokens?: number;
  windowSizeChars?: number;
  windowSizeLines?: number;
  stepTokens?: number;
  stepLines?: number;
  stepChars?: number;
}
