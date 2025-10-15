import { stat } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { FileDetectionResult, ContentFilterOptions } from './types';

const DEFAULT_BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.7z',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.bin',
  '.class',
  '.jar',
  '.wasm',
  '.dylib',
]);

const DEFAULT_GENERATED_DIRECTORIES = ['dist', 'build', 'out', 'vendor', 'tmp', '.next'];

const DEFAULT_GENERATED_PATTERNS = [
  /\bmin\.(js|css)$/, // minified assets
  /manifest\.json$/, // build manifests
  /yarn.lock$/, // lockfiles
  /package-lock\.json$/, // lockfiles
  /pnpm-lock\.yaml$/, // lockfiles
  /Cargo.lock$/, // lockfiles
  /poetry.lock$/, // lockfiles
  /vendor[\\/].*\.(js|css|map)$/, // vendored assets
  /.*\.generated\.(ts|js|py|go)$/, // generated code
];

const DEFAULT_LARGE_FILE_THRESHOLD = 1024 * 1024 * 2; // 2 MB

export class FileDetector {
  constructor(private readonly options: ContentFilterOptions = {}) {}

  async inspect(path: string): Promise<FileDetectionResult> {
    const stats = await stat(path);
    const ext = extname(path).toLowerCase();
    const fileName = basename(path);
    const binaryExtensions = new Set([
      ...DEFAULT_BINARY_EXTENSIONS,
      ...(this.options.binaryExtensions ?? []),
    ]);
    const generatedDirectories = new Set(
      [...DEFAULT_GENERATED_DIRECTORIES, ...(this.options.generatedDirectories ?? [])].map((dir) =>
        dir.toLowerCase(),
      ),
    );
    const generatedPatterns = [...DEFAULT_GENERATED_PATTERNS, ...(this.options.generatedPatterns ?? [])];

    const isBinary = binaryExtensions.has(ext) || (this.options.binaryMimeSniff ? await this.detectBinaryByContent(path) : false);
    const isLarge = stats.size >= (this.options.largeFileThresholdBytes ?? DEFAULT_LARGE_FILE_THRESHOLD);
    const isGenerated = this.isGeneratedFile(path, fileName, generatedDirectories, generatedPatterns);

    return {
      path,
      size: stats.size,
      isBinary,
      isLarge,
      isGenerated,
      reason: this.buildReason({ isBinary, isLarge, isGenerated }),
    };
  }

  private isGeneratedFile(
    path: string,
    fileName: string,
    directories: Set<string>,
    patterns: RegExp[],
  ): boolean {
    if (patterns.some((pattern) => pattern.test(path) || pattern.test(fileName))) {
      return true;
    }
    return path
      .split(/[\\/]/)
      .some((segment) => directories.has(segment.toLowerCase()));
  }

  private async detectBinaryByContent(path: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    const fileHandle = await fs.open(path, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await fileHandle.read(buffer, 0, buffer.length, 0);
      for (let i = 0; i < bytesRead; i += 1) {
        const byte = buffer[i];
        if (byte === 0) {
          return true;
        }
      }
      return false;
    } finally {
      await fileHandle.close();
    }
  }

  private buildReason(flags: { isBinary: boolean; isLarge: boolean; isGenerated: boolean }): string | undefined {
    const reasons: string[] = [];
    if (flags.isBinary) {
      reasons.push('binary');
    }
    if (flags.isLarge) {
      reasons.push('large');
    }
    if (flags.isGenerated) {
      reasons.push('generated');
    }
    if (reasons.length === 0) {
      return undefined;
    }
    return reasons.join(', ');
  }
}
