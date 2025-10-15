#!/usr/bin/env ts-node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileDetector } from '../src/normalization/detector';
import { ContentNormalizer } from '../src/normalization/normalize';
import { ContentSanitizer } from '../src/normalization/sanitizer';
import { ContentDeduplicator } from '../src/normalization/deduplicator';
import { SecretScanner } from '../src/normalization/secretScanner';

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: ts-node scripts/dry-run-filter.ts <file>');
    process.exit(1);
  }

  const path = resolve(file);
  const detector = new FileDetector({ binaryMimeSniff: true });
  const info = await detector.inspect(path);

  console.log('File info:', info);

  if (info.isBinary || info.isLarge || info.isGenerated) {
    console.log('Skipping normalization/sanitization because file is filtered.');
    return;
  }

  const content = await readFile(path, 'utf8');
  const normalizer = new ContentNormalizer({
    removeBom: true,
    normalizeLineEndings: 'lf',
    trimTrailingWhitespace: true,
    collapseMultipleBlanks: true,
  });
  const normalized = normalizer.normalize(content);

  console.log('Normalization summary:', {
    originalLength: normalized.originalLength,
    normalizedLength: normalized.normalizedLength,
    removedBom: normalized.removedBom,
    normalizedLineEndings: normalized.normalizedLineEndings,
    trimmedTrailingWhitespace: normalized.trimmedTrailingWhitespace,
  });

  const sanitizer = new ContentSanitizer({
    rules: [
      {
        id: 'secrets',
        description: 'Mask .env style secrets',
        pattern: /(API_KEY|SECRET|TOKEN)=([^\n]+)/g,
        replacement: '$1=***',
      },
    ],
  });
  const sanitized = sanitizer.sanitize(normalized.normalized);
  console.log('Sanitization applied rules:', sanitized.appliedRules);

  const scanner = new SecretScanner();
  const secretFindings = scanner.scan(sanitized.sanitized, path);
  if (secretFindings.length > 0) {
    console.log('Potential secrets:', secretFindings);
  }

  const deduplicator = new ContentDeduplicator();
  const dedupResult = deduplicator.isDuplicate(sanitized.sanitized, path);
  console.log('Deduplication result:', dedupResult);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
