import { Tokenizer, TokenizerEncodeResult } from '../types';

const TOKEN_REGEX =
  /[A-Za-z0-9_]+|[\u00C0-\u024F]+|[^\s]/gu; // fallback: words, unicode letters, or single non-whitespace char

export class BasicTokenizer implements Tokenizer {
  readonly id = 'basic';
  readonly version = '1.0.0';

  count(text: string): number {
    return this.encode(text).count;
  }

  encode(text: string): TokenizerEncodeResult {
    const matches = Array.from(text.matchAll(TOKEN_REGEX));
    const tokens = matches.map((_, index) => index);
    const offsets = matches.map((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      return { start, end };
    });
    return {
      tokens,
      count: tokens.length,
      offsets,
    };
  }
}
