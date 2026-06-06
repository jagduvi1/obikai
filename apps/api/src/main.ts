import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type AppConfig, ConfigError, loadConfig } from '@obikai/config';
import { connectMongo } from '@obikai/db';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module.js';

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

  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config));

  // Honour the operator's reverse-proxy depth so req.ip / X-Forwarded-* are trusted correctly
  // (ADR-0009: trustProxyHops is operator-configured, never assumed).
  app.set('trust proxy', config.trustProxyHops);

  // Coarse brute-force + scrypt-CPU-amplification guard on the unauthenticated auth endpoints
  // (ADR-0012 review fix). Keyed by client IP (req.ip is reliable once trust proxy is set).
  app.use(
    '/auth',
    rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false }),
  );

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
