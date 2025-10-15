export interface FileDetectionResult {
  path: string;
  size: number;
  isBinary: boolean;
  isLarge: boolean;
  isGenerated: boolean;
  reason?: string;
}

export interface ContentNormalizationResult {
  normalized: string;
  originalLength: number;
  normalizedLength: number;
  removedBom?: boolean;
  normalizedLineEndings?: boolean;
  trimmedTrailingWhitespace?: boolean;
}

export interface ContentFilterOptions {
  maxFileSizeBytes?: number;
  binaryExtensions?: string[];
  generatedDirectories?: string[];
  generatedPatterns?: RegExp[];
  largeFileThresholdBytes?: number;
  binaryMimeSniff?: boolean;
}

export interface NormalizationOptions {
  normalizeLineEndings?: 'lf' | 'crlf' | 'none';
  trimTrailingWhitespace?: boolean;
  removeBom?: boolean;
  collapseMultipleBlanks?: boolean;
  preserveMarkdownTables?: boolean;
}

export interface SanitizationRule {
  id: string;
  description: string;
  pattern: RegExp;
  replacement: string;
}

export interface SanitizationOptions {
  rules: SanitizationRule[];
}

export interface SecretPattern {
  id: string;
  description: string;
  pattern: RegExp;
}

export interface SecretFinding {
  path: string;
  line: number;
  ruleId: string;
  excerpt: string;
}
