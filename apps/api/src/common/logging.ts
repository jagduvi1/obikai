import type { LoggerService } from '@nestjs/common';
import type { Logger as AdapterLogger } from '@obikai/adapter-contracts';

/**
 * Single-line JSON logging for the API, matching the worker's format so one log shipper can parse
 * both (audit F3). One `jsonLine` writer feeds three consumers: the Nest app logger (`JsonLogger`),
 * the global exception filter, and the auth adapter's logger (which was previously silenced).
 */
export function jsonLine(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  meta?: Record<string, unknown>,
): void {
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify({ level, msg: message, ...(meta ?? {}) })}\n`);
}

/** Map Nest's variadic logger calls (trailing string is the context) to a structured JSON line. */
class JsonLoggerImpl implements LoggerService {
  private emit(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: unknown,
    params: unknown[],
  ): void {
    const context =
      params.length > 0 && typeof params.at(-1) === 'string' ? params.at(-1) : undefined;
    jsonLine(level, String(message), context ? { context } : undefined);
  }
  log(message: unknown, ...params: unknown[]): void {
    this.emit('info', message, params);
  }
  error(message: unknown, ...params: unknown[]): void {
    this.emit('error', message, params);
  }
  warn(message: unknown, ...params: unknown[]): void {
    this.emit('warn', message, params);
  }
  debug(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }
  verbose(message: unknown, ...params: unknown[]): void {
    this.emit('debug', message, params);
  }
}

export const jsonLogger: LoggerService = new JsonLoggerImpl();

/**
 * An adapter-contracts `Logger` that emits structured JSON under a fixed context. Replaces the
 * no-op `silentLogger` the auth adapter was given, so failed logins / lockouts are actually recorded
 * (the exact surface attackers probe — audit F3).
 */
export function adapterLogger(context: string): AdapterLogger {
  const at =
    (level: 'debug' | 'info' | 'warn' | 'error') => (msg: string, meta?: Record<string, unknown>) =>
      jsonLine(level, msg, { context, ...(meta ?? {}) });
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') };
}
