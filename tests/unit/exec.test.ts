import { describe, it, expect } from 'vitest';
import { runCommand } from '../../src/common/exec';

describe('runCommand', () => {
  it('returns stdout/stderr on success', async () => {
    const { stdout, stderr } = await runCommand(process.execPath, ['--version']);
    expect(stdout).toMatch(/^v\d+/);
    expect(stderr).toBe('');
  });

  it('throws error with output on failure', async () => {
    await expect(runCommand(process.execPath, ['--unknown-flag']))
      .rejects.toThrow(/bad option/i);
  });
});
