/* eslint-disable @typescript-eslint/no-var-requires */
import { Tokenizer, TokenizerFactory } from '../types';
import { BasicTokenizer } from './basic';

export class TokenizerRegistry {
  private factories = new Map<string, TokenizerFactory>();

  constructor() {
    this.register({
      id: 'basic',
      create: () => new BasicTokenizer(),
      heuristics: {
        suggestedChunkSize: 400,
      },
    });
  }

  register(factory: TokenizerFactory): void {
    this.factories.set(factory.id, factory);
  }

  unregister(id: string): void {
    this.factories.delete(id);
  }

  has(id: string): boolean {
    return this.factories.has(id);
  }

  create(id: string): Tokenizer {
    const factory = this.factories.get(id);
    if (!factory) {
      throw new Error(`Tokenizer "${id}" is not registered`);
    }
    return factory.create();
  }

  list(): TokenizerFactory[] {
    return [...this.factories.values()];
  }

  /**
   * Attempt to resolve a tokenizer. If not present, optionally try to auto-register.
   */
  resolve(id: string): Tokenizer {
    if (this.factories.has(id)) {
      return this.create(id);
    }
    switch (id) {
      case 'tiktoken':
        this.register({
          id,
          create: () => tryLoadTiktokenTokenizer(),
        });
        break;
      case 'sentencepiece':
        this.register({
          id,
          create: () => tryLoadSentencePieceTokenizer(),
        });
        break;
      default:
        throw new Error(`Tokenizer "${id}" is not registered and no auto-loader available`);
    }
    return this.create(id);
  }
}

function tryLoadTiktokenTokenizer(): Tokenizer {
  try {
    // Lazy load to avoid dependency during CI unless needed
    const { encoding_for_model } = require('tiktoken');
    const encoder = encoding_for_model('gpt-4');
    return {
      id: 'tiktoken',
      version: 'gpt-4',
      count(text: string): number {
        return encoder.encode(text).length;
      },
      encode(text: string) {
        const tokens = encoder.encode(text);
        return { tokens, count: tokens.length };
      },
      decode(tokens: number[]) {
        return encoder.decode(tokens);
      },
      maxTokens: 8192,
    };
  } catch (error) {
    throw new Error(
      `Tokenizer "tiktoken" is not available. Install "tiktoken" to enable it. Original error: ${error}`,
    );
  }
}

function tryLoadSentencePieceTokenizer(): Tokenizer {
  try {
    const sentencepiece = require('sentencepiece');
    const sp = new sentencepiece.SentencePieceProcessor();
    const modelPath = process.env.SENTENCEPIECE_MODEL;
    if (!modelPath) {
      throw new Error('SENTENCEPIECE_MODEL environment variable is not set');
    }
    sp.load(modelPath);
    return {
      id: 'sentencepiece',
      version: sp.getPieceSize().toString(),
      count(text: string): number {
        return sp.encode(text).length;
      },
      encode(text: string) {
        const tokens = sp.encode(text);
        return { tokens, count: tokens.length };
      },
      decode(tokens: number[]) {
        return sp.decode(tokens);
      },
    };
  } catch (error) {
    throw new Error(
      `Tokenizer "sentencepiece" is not available. Install "sentencepiece" and set SENTENCEPIECE_MODEL. Original error: ${error}`,
    );
  }
}

export const tokenizerRegistry = new TokenizerRegistry();
