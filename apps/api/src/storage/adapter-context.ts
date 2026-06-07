import { Logger as NestLogger } from '@nestjs/common';
import type { AdapterContext, Logger, SecretRef } from '@obikai/adapter-contracts';

/**
 * Build the runtime `AdapterContext` storage adapters are constructed with (ADR-0003/0009): a
 * Nest-backed logger, a real clock, and an env-only secret reader (the only `SecretRef.source` we
 * support without a vault). Kept tiny and framework-light so adapters stay vendor/Nest-agnostic.
 */
export function makeAdapterContext(name: string): AdapterContext {
  const nest = new NestLogger(name);
  const fmt = (msg: string, meta?: Record<string, unknown>): string =>
    meta ? `${msg} ${JSON.stringify(meta)}` : msg;
  const logger: Logger = {
    debug: (msg, meta) => nest.debug(fmt(msg, meta)),
    info: (msg, meta) => nest.log(fmt(msg, meta)),
    warn: (msg, meta) => nest.warn(fmt(msg, meta)),
    error: (msg, meta) => nest.error(fmt(msg, meta)),
  };
  return {
    logger,
    clock: () => new Date(),
    readSecret: (ref: SecretRef): Promise<string> => {
      if (ref.source === 'env') {
        const value = process.env[ref.key];
        if (!value) return Promise.reject(new Error(`secret env "${ref.key}" is not set`));
        return Promise.resolve(value);
      }
      return Promise.reject(new Error('vault secret source is not supported in this deployment'));
    },
  };
}
