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
      stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf8'),
      stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr.toString('utf8'),
    };
  } catch (error) {
    if (error instanceof Error) {
      const errorStdout = (error as { stdout?: Buffer | string }).stdout;
      const errorStderr = (error as { stderr?: Buffer | string }).stderr;
      const stdout = typeof errorStdout === 'string' ? errorStdout : errorStdout?.toString('utf8') ?? '';
      const stderr = typeof errorStderr === 'string' ? errorStderr : errorStderr?.toString('utf8') ?? '';
      const cmdString = [file, ...args].join(' ');
      throw new Error(
        `Command failed (${cmdString}): ${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`,
      );
    }
    throw error;
  }
}
