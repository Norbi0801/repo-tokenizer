import { Writable } from 'node:stream';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';
export type LogFormat = 'text' | 'json';

interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  destination?: Writable;
  scope?: string;
}

const LEVEL_VALUES: Record<LogLevel, number> = {
  silent: 100,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

const DEFAULT_OPTIONS: Required<Omit<LoggerOptions, 'scope'>> = {
  level: 'info',
  format: 'text',
  destination: process.stderr,
};

function formatScope(scope?: string): string {
  if (!scope) {
    return '';
  }
  return `[${scope}] `;
}

export class Logger {
  private level: LogLevel;
  private format: LogFormat;
  private destination: Writable;
  private scope?: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? DEFAULT_OPTIONS.level;
    this.format = options.format ?? DEFAULT_OPTIONS.format;
    this.destination = options.destination ?? DEFAULT_OPTIONS.destination;
    this.scope = options.scope;
  }

  child(scope: string): Logger {
    return new Logger({
      level: this.level,
      format: this.format,
      destination: this.destination,
      scope: this.scope ? `${this.scope}:${scope}` : scope,
    });
  }

  configure(options: LoggerOptions): void {
    if (options.level) {
      this.level = options.level;
    }
    if (options.format) {
      this.format = options.format;
    }
    if (options.destination) {
      this.destination = options.destination;
    }
    if (options.scope !== undefined) {
      this.scope = options.scope;
    }
  }

  getLevel(): LogLevel {
    return this.level;
  }

  debug(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('debug', message, metadata);
  }

  info(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('info', message, metadata);
  }

  warn(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('warn', message, metadata);
  }

  error(message: string, metadata: Record<string, unknown> = {}): void {
    this.write('error', message, metadata);
  }

  private write(level: Exclude<LogLevel, 'silent'>, message: string, metadata: Record<string, unknown>) {
    if (LEVEL_VALUES[this.level] > LEVEL_VALUES[level]) {
      return;
    }

    const timestamp = new Date().toISOString();
    if (this.format === 'json') {
      const payload = {
        level,
        time: timestamp,
        message,
        scope: this.scope,
        ...metadata,
      };
      this.destination.write(`${JSON.stringify(payload)}\n`);
      return;
    }

    const prefix = `${timestamp} ${level.toUpperCase()} `;
    const strMetadata = Object.keys(metadata).length > 0 ? ` ${JSON.stringify(metadata)}` : '';
    this.destination.write(`${prefix}${formatScope(this.scope)}${message}${strMetadata}\n`);
  }
}

const globalLogger = new Logger();

export function getLogger(scope?: string): Logger {
  return scope ? globalLogger.child(scope) : globalLogger;
}

export function configureLogger(options: LoggerOptions): void {
  globalLogger.configure(options);
}
