import { describe, it, expect, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { Logger } from '../../src/common/logger';

class MemoryWritable extends Writable {
  chunks: string[] = [];

  _write(chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
    this.chunks.push(chunk.toString());
    callback();
  }
}

describe('Logger', () => {
  let destination: MemoryWritable;
  let logger: Logger;

  beforeEach(() => {
    destination = new MemoryWritable();
    logger = new Logger({ destination, level: 'debug', format: 'text' });
  });

  it('respects log levels', () => {
    logger.configure({ level: 'warn' });
    logger.info('should be filtered');
    logger.warn('should be emitted');
    expect(destination.chunks.length).toBe(1);
    expect(destination.chunks[0]).toContain('should be emitted');
  });

  it('emits json payload', () => {
    logger.configure({ format: 'json', level: 'debug' });
    logger.debug('payload', { foo: 'bar' });
    expect(destination.chunks.length).toBe(1);
    const payload = JSON.parse(destination.chunks[0]);
    expect(payload.level).toBe('debug');
    expect(payload.message).toBe('payload');
    expect(payload.foo).toBe('bar');
  });

  it('creates scoped children', () => {
    const child = logger.child('test');
    child.info('hello');
    const payload = destination.chunks.join('');
    expect(payload).toContain('[test]');
    expect(payload).toContain('hello');
  });
});
