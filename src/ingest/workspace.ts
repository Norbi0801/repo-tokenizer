import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { WorkspaceInfo } from './types';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectPnpmWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'pnpm-workspace.yaml');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }

  const contents = await readFile(manifestPath, 'utf8');
  const packagePatterns: string[] = [];
  const lines = contents.split(/\r?\n/);
  let inPackages = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('packages:')) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      if (trimmed.startsWith('-')) {
        packagePatterns.push(trimmed.replace(/^-?\s*/, ''));
      } else if (trimmed === '') {
        continue;
      } else if (!line.startsWith(' ') && !line.startsWith('\t')) {
        inPackages = false;
      }
    }
  }

  return {
    type: 'pnpm',
    manifest: manifestPath,
    root,
    packages: packagePatterns.length > 0 ? packagePatterns : undefined,
  };
}

async function detectPackageJsonWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'package.json');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }

  try {
    const pkgJson = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      workspaces?: string[] | { packages?: string[] };
      private?: boolean;
    };
    let packages: string[] | undefined;
    if (Array.isArray(pkgJson.workspaces)) {
      packages = pkgJson.workspaces;
    } else if (pkgJson.workspaces && Array.isArray(pkgJson.workspaces.packages)) {
      packages = pkgJson.workspaces.packages;
    }
    if (packages && packages.length > 0) {
      return {
        type: 'yarn',
        manifest: manifestPath,
        root,
        packages,
      };
    }
    if (pkgJson.private && packages && packages.length === 0) {
      return {
        type: 'npm',
        manifest: manifestPath,
        root,
      };
    }
  } catch {
    // ignore JSON parse errors
  }
  return undefined;
}

async function detectGoWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'go.work');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }
  const contents = await readFile(manifestPath, 'utf8');
  const packages = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('use '))
    .map((line) => line.replace(/^use\s+/, '').replace(/["']/g, ''));
  return {
    type: 'go',
    manifest: manifestPath,
    root,
    packages: packages.length > 0 ? packages : undefined,
  };
}

async function detectCargoWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'Cargo.toml');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }
  const contents = await readFile(manifestPath, 'utf8');
  if (!/\[workspace\]/.test(contents)) {
    return undefined;
  }

  const membersMatch = contents.match(/\[workspace\][^[]*?members\s*=\s*\[([^\]]*)\]/s);
  const packages =
    membersMatch?.[1]
      ?.split(',')
      .map((item) => item.trim().replace(/["']/g, ''))
      .filter((item) => item.length > 0) ?? undefined;

  return {
    type: 'cargo',
    manifest: manifestPath,
    root,
    packages,
  };
}

async function detectBazelWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'WORKSPACE');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }
  return {
    type: 'bazel',
    manifest: manifestPath,
    root,
  };
}

async function detectLernaWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'lerna.json');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }
  try {
    const lerna = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      packages?: string[];
    };
    return {
      type: 'lerna',
      manifest: manifestPath,
      root,
      packages: lerna.packages,
    };
  } catch {
    return {
      type: 'lerna',
      manifest: manifestPath,
      root,
    };
  }
}

async function detectRushWorkspace(root: string): Promise<WorkspaceInfo | undefined> {
  const manifestPath = join(root, 'rush.json');
  if (!(await fileExists(manifestPath))) {
    return undefined;
  }
  try {
    const rush = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      projects?: { packageName: string; projectFolder: string }[];
    };
    const packages = rush.projects?.map((project) => project.projectFolder);
    return {
      type: 'rush',
      manifest: manifestPath,
      root,
      packages,
    };
  } catch {
    return {
      type: 'rush',
      manifest: manifestPath,
      root,
    };
  }
}

export async function detectWorkspaces(root: string): Promise<WorkspaceInfo[]> {
  const detectors = [
    detectPnpmWorkspace,
    detectPackageJsonWorkspace,
    detectGoWorkspace,
    detectCargoWorkspace,
    detectBazelWorkspace,
    detectLernaWorkspace,
    detectRushWorkspace,
  ];

  const results: WorkspaceInfo[] = [];
  for (const detector of detectors) {
    const info = await detector(root);
    if (info) {
      results.push(info);
    }
  }
  return results;
}
