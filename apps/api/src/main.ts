import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type AppConfig, ConfigError, loadConfig } from '@obikai/config';
import { connectMongo, disconnectMongo } from '@obikai/db';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { jsonLogger } from './common/logging.js';

/** Default HTTP port when PORT is unset/blank. */
const DEFAULT_PORT = 3000;

/**
 * Boot the API. Order matters: validate config FIRST so a misconfigured deployment fails fast with
 * a readable error before any server socket or DB handle is opened (ADR-0009).
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('bootstrap');

  let config: AppConfig;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  // Mongo is mandatory infra (invariant 10). Connect before serving so the tenant-scoped
  // repositories have a live connection; fail fast if it is unreachable.
  await connectMongo(config.mongoUri);
  logger.log('connected to MongoDB');

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    // Structured single-line JSON logs, matching the worker so one shipper parses both (F3).
    logger: jsonLogger,
  });

  // Catch every unmapped error: structured log + request id, generic 500 body (no leak) — F2.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Honour the operator's reverse-proxy depth so req.ip / X-Forwarded-* are trusted correctly
  // (ADR-0009: trustProxyHops is operator-configured, never assumed).
  app.set('trust proxy', config.trustProxyHops);

  // Security headers on the JSON API itself (the SPA tier was already hardened at the edge). HSTS,
  // nosniff, frameguard, no-referrer, etc. — safe defaults for an API serving credentials + PII.
  app.use(helmet());

  // CORS: the SPAs are a DIFFERENT origin in dev (localhost:5173 → :3000) and in any split deploy.
  // Explicit allow-list (credentials:true forbids `*`); empty = same-origin only. Bootstrap-only env,
  // read here like PORT. Comma-separated, e.g. CORS_ORIGINS="https://app.dojo.se,http://localhost:5173".
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (corsOrigins.length > 0) {
    app.enableCors({ origin: corsOrigins, credentials: true });
    logger.log(`CORS enabled for ${corsOrigins.length} origin(s)`);
  }

  // Coarse brute-force + scrypt-CPU-amplification guard on the unauthenticated auth endpoints
  // (ADR-0012 review fix). Keyed by client IP (req.ip is reliable once trust proxy is set).
  app.use(
    '/auth',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  );

  // Graceful shutdown: stop accepting connections, let in-flight requests drain, close Mongo cleanly
  // (truncated billing/PII writes otherwise) so deploys/rescheduling are zero-downtime-safe.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`shutting down (${signal})`);
    await app.close();
    await disconnectMongo();
    logger.log('shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const port = portFromEnv(process.env.PORT);
  await app.listen(port);
  logger.log(`Obikai API listening on :${port} (deployMode=${config.deployMode})`);
}

/** Parse PORT, falling back to the default for unset, blank, or non-numeric values. */
function portFromEnv(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

void bootstrap();
