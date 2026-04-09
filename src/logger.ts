/**
 * NEKTE Logger
 *
 * Minimal structured logger with levels.
 * Used across server, bridge, and other NEKTE packages.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(prefix: string, level: LogLevel = 'info'): Logger {
  const minPriority = LEVEL_PRIORITY[level];

  function log(lvl: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[lvl] < minPriority) return;

    const timestamp = new Date().toISOString().slice(11, 23);
    const tag = `[${prefix}]`;
    const suffix = data ? ' ' + JSON.stringify(data) : '';

    switch (lvl) {
      case 'debug':
        console.debug(`${timestamp} ${tag} ${msg}${suffix}`);
        break;
      case 'info':
        console.log(`${timestamp} ${tag} ${msg}${suffix}`);
        break;
      case 'warn':
        console.warn(`${timestamp} ${tag} ${msg}${suffix}`);
        break;
      case 'error':
        console.error(`${timestamp} ${tag} ${msg}${suffix}`);
        break;
    }
  }

  return {
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
  };
}

/** No-op logger for testing */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
