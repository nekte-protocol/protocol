import { describe, it, expect, vi } from 'vitest';
import { createLogger, silentLogger } from '../logger.js';

describe('createLogger', () => {
  it('logs info messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test');
    log.info('hello');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain('[test]');
    expect(spy.mock.calls[0][0]).toContain('hello');
    spy.mockRestore();
  });

  it('includes structured data', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const log = createLogger('test');
    log.info('event', { key: 'value' });
    expect(spy.mock.calls[0][0]).toContain('"key":"value"');
    spy.mockRestore();
  });

  it('respects log level', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('test', 'info');
    log.debug('should not appear');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('debug level shows debug messages', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const log = createLogger('test', 'debug');
    log.debug('visible');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('silent level suppresses everything', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createLogger('test', 'silent');
    log.info('nope');
    log.warn('nope');
    log.error('nope');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe('silentLogger', () => {
  it('does nothing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    silentLogger.info('ignored');
    silentLogger.warn('ignored');
    silentLogger.error('ignored');
    silentLogger.debug('ignored');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
