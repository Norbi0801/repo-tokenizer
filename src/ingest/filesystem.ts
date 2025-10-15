import { readdir, readFile, stat, cp } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { createTemporaryDirectory } from '../common/temp';
import { IgnoreMatcher, normalizePattern, compileGlobToRegExp } from '../common/ignore';
import { FileEntry, ListFilesOptions, Snapshot } from './types';

export class FilesystemRepository {
  constructor(private readonly rootPath: string) {}

  getRootPath(): string {
    return this.rootPath;
  }

  async listFiles(options: ListFilesOptions = {}): Promise<FileEntry[]> {
    const basePatterns = await this.loadRootIgnorePatterns();
    const baseMatcher = new IgnoreMatcher([...basePatterns, ...(options.excludeGlobs ?? [])]);
    const entries: FileEntry[] = [];
    await this.walkDirectory('.', baseMatcher, basePatterns, options, entries);

    let filtered = entries;
    if (options.workspaceRoots && options.workspaceRoots.length > 0) {
      const roots = options.workspaceRoots.map((root) =>
        root.endsWith('/') ? root.slice(0, -1) : root,
      );
      filtered = filtered.filter((entry) =>
        roots.some((root) => entry.path === root || entry.path.startsWith(`${root}/`)),
      );
    }

    if (options.excludeRegexes) {
      filtered = filtered.filter(
        (entry) => !options.excludeRegexes?.some((regex) => regex.test(entry.path)),
      );
    }

    if (options.sparsePatterns && options.sparsePatterns.length > 0) {
      const sparseRegexes = compilePatternList(options.sparsePatterns);
      filtered = filtered.filter((entry) =>
        sparseRegexes.some((regex) => regex.test(entry.path)),
      );
    }

    if (options.includePaths && options.includePaths.length > 0) {
      const includeRegexes = compilePatternList(options.includePaths);
      filtered = filtered.filter((entry) =>
        includeRegexes.some((regex) => regex.test(entry.path)),
      );
    }

    return filtered.sort((a, b) => a.path.localeCompare(b.path));
  }

  async createSnapshot(): Promise<Snapshot> {
    const temp = await createTemporaryDirectory('repo-fs-snapshot-');
    await cp(this.rootPath, temp.path, { recursive: true, force: true });

    return {
      path: temp.path,
      cleanup: temp.cleanup,
    };
  }

  private async walkDirectory(
    relativeDir: string,
    matcher: IgnoreMatcher,
    inheritedPatterns: string[],
    options: ListFilesOptions,
    entries: FileEntry[],
  ): Promise<void> {
    const absoluteDir = join(this.rootPath, relativeDir);
    const dirEntries = await readdir(absoluteDir, { withFileTypes: true });

    for (const entry of dirEntries) {
      const relPath = relativeDir === '.' ? entry.name : `${relativeDir}/${entry.name}`;

      if (relPath === '.git') {
        continue;
      }

      const ignored = matcher.match(relPath);
      if (ignored) {
        continue;
      }

      const fullPath = join(this.rootPath, relPath);
      if (entry.isDirectory()) {
        const subPatterns = await this.loadIgnorePatternsForDir(fullPath, relPath);
        const nextPatterns = [...inheritedPatterns, ...subPatterns];
        const nextMatcher = new IgnoreMatcher([...nextPatterns, ...(options.excludeGlobs ?? [])]);
        await this.walkDirectory(relPath, nextMatcher, nextPatterns, options, entries);
      } else if (entry.isFile()) {
        const fileStats = await stat(fullPath);
        entries.push({
          path: relPath,
          size: fileStats.size,
          executable: (fileStats.mode & 0o111) !== 0,
        });
      }
    }
  }

  private async loadRootIgnorePatterns(): Promise<string[]> {
    return this.loadIgnorePatternsForDir(this.rootPath, '.');
  }

  private async loadIgnorePatternsForDir(dirPath: string, relativeDir: string): Promise<string[]> {
    const gitignorePath = join(dirPath, '.gitignore');
    try {
      const contents = await readFile(gitignorePath, 'utf8');
      return this.prefixPatterns(contents, relativeDir);
    } catch {
      return [];
    }
  }

  private prefixPatterns(contents: string, relativeDir: string): string[] {
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((pattern) => {
        const negate = pattern.startsWith('!');
        const body = negate ? pattern.slice(1) : pattern;
        let qualified = body;
        if (body.startsWith('/')) {
          qualified = body.slice(1);
        } else if (relativeDir !== '.' && relativeDir !== '') {
          const normalizedDir = relativeDir.split(sep).join('/');
          qualified = `${normalizedDir}/${body}`;
        }
        return negate ? `!${qualified}` : qualified;
      });
  }
}

function compilePatternList(patterns: string[]): RegExp[] {
  return patterns
    .map((pattern) => {
      const cleaned = pattern.startsWith('!') ? pattern.slice(1) : pattern;
      const normalized = normalizePattern(cleaned);
      if (!normalized) {
        return undefined;
      }
      return compileGlobToRegExp(normalized.body);
    })
    .filter((regex): regex is RegExp => regex !== undefined);
}
