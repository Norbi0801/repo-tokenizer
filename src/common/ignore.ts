import { sep } from 'node:path';

export interface IgnoreRule {
  pattern: string;
  negate: boolean;
  regex: RegExp;
}

/**
 * Convert a gitignore-style glob into a regular expression.
 * The implementation is intentionally simple but covers **, *, ?, [...].
 */
export function compileGlobToRegExp(pattern: string): RegExp {
  const normalized = pattern
    .split(sep)
    .join('/'); // normalise path separators for cross-platform use

  let regex = '';
  let i = 0;
  while (i < normalized.length) {
    const char = normalized[i];
    if (char === '*') {
      const next = normalized[i + 1];
      if (next === '*') {
        // Handle **/ or ** pattern
        const after = normalized[i + 2];
        if (after === '/') {
          regex += '(?:.*/)?';
          i += 3;
        } else {
          regex += '.*';
          i += 2;
        }
      } else {
        regex += '[^/]*';
        i += 1;
      }
      continue;
    }
    if (char === '?') {
      regex += '[^/]';
      i += 1;
      continue;
    }
    if (char === '[') {
      const end = normalized.indexOf(']', i + 1);
      if (end !== -1) {
        const content = normalized.slice(i + 1, end);
        regex += `[${content}]`;
        i = end + 1;
        continue;
      }
    }
    // Escape regex special characters
    if (/[-\\^$+?.()|{}]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
    i += 1;
  }

  return new RegExp(`^${regex}$`);
}

export interface NormalizedPattern {
  original: string;
  negate: boolean;
  body: string;
}

export function normalizePattern(pattern: string): NormalizedPattern | undefined {
  const trimmed = pattern.trim();
  if (trimmed === '' || trimmed.startsWith('#')) {
    return undefined;
  }

  let negate = false;
  let body = trimmed;
  if (trimmed.startsWith('!')) {
    negate = true;
    body = trimmed.slice(1);
  }
  if (!body.includes('/')) {
    body = `**/${body}`;
  }
  if (body.endsWith('/')) {
    body = `${body}**`;
  }

  return { original: trimmed, negate, body };
}

export class IgnoreMatcher {
  private readonly rawPatterns: string[];
  private readonly rules: IgnoreRule[];

  constructor(patterns: string[] = []) {
    const normalized = patterns
      .map((pattern) => normalizePattern(pattern))
      .filter((entry): entry is NormalizedPattern => entry !== undefined);

    this.rawPatterns = normalized.map((entry) => entry.original);

    this.rules = normalized.map((entry) => {
      const regex = compileGlobToRegExp(entry.body);
      return { pattern: entry.original, negate: entry.negate, regex };
    });
  }

  match(path: string): boolean {
    const normalized = path.split(sep).join('/');
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.regex.test(normalized)) {
        ignored = !rule.negate;
      }
    }
    return ignored;
  }

  static fromFileContents(contents: string): IgnoreMatcher {
    const patterns = contents
      .split(/\r?\n/)
      .map((line) => line.trim());
    return new IgnoreMatcher(patterns);
  }

  get patterns(): string[] {
    return [...this.rawPatterns];
  }
}
