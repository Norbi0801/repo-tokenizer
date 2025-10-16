import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IndexManager } from '../../src/indexer';
import type { GitProvider, PullRequestDetails, CommitStatusPayload } from '../../src/integrations';

async function createTempDir(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

describe('IndexManager pull request integration', () => {
  let manager: IndexManager;

  beforeEach(() => {
    manager = new IndexManager();
  });

  it('indexes only changed files and posts comment/status updates', async () => {
    const repoDir = await createTempDir('repo-tokenizer-pr-');
    try {
      await writeFile(join(repoDir, 'changed.txt'), 'hello world');
      await writeFile(join(repoDir, 'ignored.txt'), 'not included');

      const statusCalls: CommitStatusPayload[] = [];
      let commentBody: string | undefined;
      const prDetails: PullRequestDetails = {
        id: 101,
        number: 101,
        title: 'Update docs',
        url: 'https://example.test/pr/101',
        headRef: 'feature/docs',
        headSha: 'abc123def456',
        baseRef: 'main',
        baseSha: '000000decaf',
        files: [
          { path: 'changed.txt', status: 'modified' },
          { path: 'removed.txt', status: 'removed' },
        ],
      };

      const provider: GitProvider = {
        kind: 'github',
        fetchPullRequest: async () => prDetails,
        createComment: async (_, body) => {
          commentBody = body;
        },
        setCommitStatus: async (_, payload) => {
          statusCalls.push(payload);
        },
      };

      const result = await manager.indexPullRequest(
        { type: 'filesystem', path: repoDir },
        { provider: 'github', id: 101 },
        {
          providers: {},
          comment: { enabled: true, template: 'Files={{files}} Chunks={{chunks}}' },
          status: {
            enabled: true,
            context: 'repo-tokenizer/test',
            targetUrl: 'https://example.test/report',
            failOnSecretFindings: true,
          },
          providerFactory: () => provider,
        },
      );

      expect(result.index.files).toHaveLength(1);
      expect(result.index.files[0].path).toBe('changed.txt');
      expect(result.commentSubmitted).toBe(true);
      expect(result.statusSubmitted).toBe(true);
      expect(statusCalls[0]?.state).toBe('pending');
      expect(statusCalls.at(-1)?.state).toBe('success');
      expect(commentBody).toContain('Files=1');
      expect(result.statusPayload?.state).toBe('success');
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
