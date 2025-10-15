import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runCommand } from '../common/exec';
import { createTemporaryDirectory } from '../common/temp';
import { IgnoreMatcher } from '../common/ignore';
import {
  DiffResult,
  FileEntry,
  GitReference,
  GitRefType,
  ListFilesOptions,
  Snapshot,
  WorkspaceInfo,
} from './types';
import { detectWorkspaces } from './workspace';

export interface GitRepositoryConfig {
  /**
   * Local filesystem path to the repository.
   * If not present, `url` must be provided and the repository will be cloned to a temporary location.
   */
  path?: string;
  /**
   * Remote repository URL (https or ssh). Used when `path` is not provided or when explicit refresh is needed.
   */
  url?: string;
  /**
   * Optional directory for storing temporary clones/worktrees. Defaults to system temp.
   */
  cacheDir?: string;
  /**
   * Perform shallow clone (depth=1) when cloning from remote.
   */
  shallow?: boolean;
}

export class GitRepository {
  private readonly config: GitRepositoryConfig;
  private localPath?: string;
  private clonedTempDir?: { path: string; cleanup: () => Promise<void> };
  private cachedWorkspaces?: WorkspaceInfo[];

  private constructor(config: GitRepositoryConfig) {
    this.config = config;
  }

  static async open(config: GitRepositoryConfig): Promise<GitRepository> {
    const repo = new GitRepository(config);
    await repo.ensureLocalPath();
    return repo;
  }

  async getLocalPath(): Promise<string> {
    return this.ensureLocalPath();
  }

  async updateSubmodules(): Promise<void> {
    const cwd = await this.ensureLocalPath();
    await runCommand('git', ['submodule', 'update', '--init', '--recursive'], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).catch(() => undefined);
  }

  async installLfs(): Promise<void> {
    const cwd = await this.ensureLocalPath();
    await runCommand('git', ['lfs', 'install', '--local'], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).catch(() => undefined);
  }

  async listReferences(): Promise<GitReference[]> {
    const cwd = await this.ensureLocalPath();
    const defaultBranch = await this.getDefaultBranch();
    const { stdout } = await runCommand('git', ['for-each-ref', '--format=%(refname)\t%(objectname)\t%(upstream)\t%(refname:short)', 'refs/heads', 'refs/tags', 'refs/remotes'], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    const lines = stdout.trim().split('\n').filter(Boolean);
    const refs: GitReference[] = lines.map((line) => {
      const [fullName, commit, upstream, shortName] = line.split('\t');
      const type = this.detectRefType(fullName);
      const ref: GitReference = {
        name: shortName ?? fullName,
        fullName,
        type,
        commit,
      };

      if (defaultBranch && type === 'branch' && ref.name === defaultBranch) {
        ref.isDefault = true;
      }
      return ref;
    });

    return refs;
  }

  async resolveRef(ref: string): Promise<string> {
    const cwd = await this.ensureLocalPath();
    const { stdout } = await runCommand('git', ['rev-parse', ref], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout.trim();
  }

  async getDefaultBranch(): Promise<string | undefined> {
    const cwd = await this.ensureLocalPath();
    const { stdout } = await runCommand('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).catch(() => ({ stdout: '' }));

    if (!stdout) {
      return undefined;
    }
    const match = stdout.trim().match(/^refs\/remotes\/origin\/(.+)$/);
    return match?.[1];
  }

  async getMergeBase(refA: string, refB: string): Promise<string> {
    const cwd = await this.ensureLocalPath();
    const { stdout } = await runCommand('git', ['merge-base', refA, refB], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    return stdout.trim();
  }

  async listChangedFiles(baseRef: string, headRef: string): Promise<DiffResult> {
    const cwd = await this.ensureLocalPath();
    const { stdout } = await runCommand('git', ['diff', '--name-status', baseRef, headRef], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const changed: string[] = [];
    const deleted: string[] = [];
    stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const [status, path] = line.split(/\s+/, 2);
        if (!status || !path) {
          return;
        }
        if (status.startsWith('D')) {
          deleted.push(path);
        } else {
          changed.push(path);
        }
      });
    return { changed, deleted };
  }

  async createSnapshot(options: { ref?: string; sparsePatterns?: string[] } = {}): Promise<Snapshot> {
    const cwd = await this.ensureLocalPath();
    const commit = options.ref ? await this.resolveRef(options.ref) : await this.resolveRef('HEAD');
    const temp = await createTemporaryDirectory('repo-snapshot-');
    const worktreePath = join(temp.path, 'worktree');
    await mkdir(worktreePath, { recursive: true });

    await runCommand('git', ['worktree', 'add', '--detach', worktreePath, commit], {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    if (options.sparsePatterns && options.sparsePatterns.length > 0) {
      const containsWildcard = options.sparsePatterns.some((pattern) => /[*?\[]/.test(pattern));
      const initArgs = containsWildcard ? ['sparse-checkout', 'init', '--no-cone'] : ['sparse-checkout', 'init', '--cone'];
      await runCommand('git', initArgs, {
        cwd: worktreePath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      await runCommand('git', ['sparse-checkout', 'set', ...options.sparsePatterns], {
        cwd: worktreePath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    }

    return {
      path: worktreePath,
      commit,
      cleanup: async () => {
        await runCommand('git', ['worktree', 'remove', '--force', worktreePath], {
          cwd,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        await temp.cleanup();
      },
    };
  }

  async listFiles(options: ListFilesOptions = {}): Promise<FileEntry[]> {
    const cwd = await this.ensureLocalPath();
    const ref = options.ref ? await this.resolveRef(options.ref) : await this.resolveRef('HEAD');
    const tracked = await this.listTrackedFiles(cwd, ref, options);
    const includeUntracked = options.includeUntracked ?? false;

    if (!includeUntracked) {
      return tracked.sort((a, b) => a.path.localeCompare(b.path));
    }

    const untracked = await this.listUntrackedFiles(cwd, options);
    const combined = [...tracked];
    for (const entry of untracked) {
      if (!combined.some((item) => item.path === entry.path)) {
        combined.push(entry);
      }
    }
    const filtered = this.applyExcludes(combined, options);
    return filtered.sort((a, b) => a.path.localeCompare(b.path));
  }

  async detectWorkspaces(): Promise<WorkspaceInfo[]> {
    if (!this.cachedWorkspaces) {
      const cwd = await this.ensureLocalPath();
      this.cachedWorkspaces = await detectWorkspaces(cwd);
    }
    return this.cachedWorkspaces;
  }

  private async ensureLocalPath(): Promise<string> {
    if (this.localPath) {
      return this.localPath;
    }
    if (this.config.path) {
      this.localPath = this.config.path;
      await runCommand('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: this.localPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      await runCommand('git', ['lfs', 'install', '--local'], {
        cwd: this.localPath,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      }).catch(() => undefined);
      return this.localPath;
    }
    if (!this.config.url) {
      throw new Error('GitRepository requires either local path or remote url');
    }

    const temp = await createTemporaryDirectory('repo-clone-');
    const cloneArgs = ['clone', this.config.url, temp.path];
    if (this.config.shallow) {
      cloneArgs.splice(1, 0, '--depth', '1');
    }
    await runCommand('git', cloneArgs, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    this.localPath = temp.path;
    this.clonedTempDir = {
      path: temp.path,
      cleanup: temp.cleanup,
    };
    return this.localPath;
  }

  async cleanup(): Promise<void> {
    if (this.clonedTempDir) {
      await this.clonedTempDir.cleanup();
      this.clonedTempDir = undefined;
      this.localPath = undefined;
    }
  }

  private detectRefType(fullName: string): GitRefType {
    if (fullName.startsWith('refs/heads/')) {
      return 'branch';
    }
    if (fullName.startsWith('refs/tags/')) {
      return 'tag';
    }
    if (fullName.startsWith('refs/remotes/')) {
      return 'remote';
    }
    return 'commit';
  }

  private async listTrackedFiles(
    cwd: string,
    ref: string,
    options: ListFilesOptions,
  ): Promise<FileEntry[]> {
    const args = ['ls-tree', '--full-tree', '-r', '--long', ref];
    const pathspecs = this.buildPathspecs(options);
    if (pathspecs.length > 0) {
      args.push('--', ...pathspecs);
    }
    const { stdout } = await runCommand('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });

    const entries = stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        // Format: <mode> <type> <object> <size>\t<path>
        const [meta, filePath] = line.split('\t');
        if (!meta || !filePath) {
          return undefined;
        }
        const parts = meta.split(' ');
        const mode = parts[0];
        const objectId = parts[2];
        const size = Number(parts[3]) || 0;
        return {
          path: filePath,
          size,
          objectId,
          executable: mode === '100755',
        } as FileEntry;
      })
      .filter((entry): entry is FileEntry => entry !== undefined);

    const filtered = this.applyExcludes(entries, options);
    return filtered.sort((a, b) => a.path.localeCompare(b.path));
  }

  private async listUntrackedFiles(cwd: string, options: ListFilesOptions): Promise<FileEntry[]> {
    const args = ['ls-files', '--others', '--exclude-standard', '-z'];
    const pathspecs = this.buildPathspecs(options);
    if (pathspecs.length > 0) {
      args.push('--', ...pathspecs);
    }
    const { stdout } = await runCommand('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const entries: FileEntry[] = [];
    const paths = stdout.split('\0').filter(Boolean);
    const fs = await import('node:fs/promises');
    for (const filePath of paths) {
      const absolute = join(cwd, filePath);
      try {
        const stats = await fs.stat(absolute);
        if (stats.isFile()) {
          entries.push({
            path: filePath,
            size: stats.size,
            executable: (stats.mode & 0o111) !== 0,
          });
        }
      } catch {
        // ignore deleted between listing/stat
      }
    }
    const filtered = this.applyExcludes(entries, options);
    return filtered.sort((a, b) => a.path.localeCompare(b.path));
  }

  private buildPathspecs(options: ListFilesOptions): string[] {
    const specs = new Set<string>();
    options.includePaths?.forEach((path) => specs.add(path));
    options.workspaceRoots?.forEach((root) => specs.add(root));
    if (options.sparsePatterns) {
      options.sparsePatterns.forEach((pattern) => specs.add(pattern));
    }
    return [...specs];
  }

  private applyExcludes(entries: FileEntry[], options: ListFilesOptions): FileEntry[] {
    let filtered = entries;
    if (options.excludeGlobs && options.excludeGlobs.length > 0) {
      const matcher = new IgnoreMatcher(options.excludeGlobs);
      filtered = filtered.filter((entry) => !matcher.match(entry.path));
    }
    if (options.excludeRegexes && options.excludeRegexes.length > 0) {
      filtered = filtered.filter(
        (entry) => !options.excludeRegexes?.some((regex) => regex.test(entry.path)),
      );
    }
    return filtered;
  }
}
