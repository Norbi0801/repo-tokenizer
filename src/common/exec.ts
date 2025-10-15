import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

/**
 * Execute a command and return the raw stdout/stderr as UTF-8 strings.
 * Throws if the command exits with non-zero status.
 */
export async function runCommand(
  file: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const { cwd, env, timeoutMs } = options;

  try {
    const result = await execFileAsync(file, args, {
      cwd,
      env,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });

    return {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    if (error instanceof Error) {
      const stdout =
        (error as { stdout?: Buffer | string }).stdout ?? '';
      const stderr =
        (error as { stderr?: Buffer | string }).stderr ?? '';
      const cmdString = [file, ...args].join(' ');
      throw new Error(
        `Command failed (${cmdString}): ${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`,
      );
    }
    throw error;
  }
}
