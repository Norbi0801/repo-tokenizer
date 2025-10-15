import { NormalizationOptions, ContentNormalizationResult } from './types';

const BOM = '\uFEFF';

export class ContentNormalizer {
  constructor(private readonly options: NormalizationOptions = {}) {}

  normalize(text: string): ContentNormalizationResult {
    let result = text;
    const originalLength = text.length;
    let removedBom = false;
    let normalizedLineEndings = false;
    let trimmedTrailingWhitespace = false;

    if (this.options.removeBom !== false && result.startsWith(BOM)) {
      result = result.slice(1);
      removedBom = true;
    }

    if (this.options.normalizeLineEndings && this.options.normalizeLineEndings !== 'none') {
      const target = this.options.normalizeLineEndings === 'lf' ? '\n' : '\r\n';
      result = result.replace(/\r\n|\n|\r/g, '\n');
      if (target === '\r\n') {
        result = result.replace(/\n/g, '\r\n');
      }
      normalizedLineEndings = true;
    }

    if (this.options.trimTrailingWhitespace) {
      const lines = result.split(/\r?\n/);
      const trimmed = lines.map((line, index) => {
        if (this.options.preserveMarkdownTables && line.includes('|')) {
          return line.replace(/\s+$/g, ' ');
        }
        return line.replace(/\s+$/g, '');
      });
      if (trimmed.some((line, index) => line !== lines[index])) {
        result = trimmed.join('\n');
        trimmedTrailingWhitespace = true;
      }
    }

    if (this.options.collapseMultipleBlanks) {
      result = result.replace(/\n{3,}/g, '\n\n');
    }

    return {
      normalized: result,
      originalLength,
      normalizedLength: result.length,
      removedBom,
      normalizedLineEndings,
      trimmedTrailingWhitespace,
    };
  }
}
