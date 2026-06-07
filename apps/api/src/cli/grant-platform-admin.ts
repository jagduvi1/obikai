import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { type AppConfig, ConfigError, loadConfig } from '@obikai/config';
import {
  IdentityRepository,
  PlatformGrantRepository,
  connectMongo,
  disconnectMongo,
} from '@obikai/db';

/**
 * `obikai grant-platform-admin <email>` — bootstrap the cross-tenant platform admin (ADR-0021/0022).
 * Platform access is a tenant-GLOBAL grant tied to a user, completely separate from any per-tenant
 * membership, so this runs without a tenant context. Idempotent: re-running re-grants the same role.
 * The user must already exist (they sign in via the normal tenant-global identity); this only grants.
 */
export async function grantPlatformAdmin(
  email: string,
  config: AppConfig,
  logger: Logger = new Logger('grant-platform-admin'),
): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) throw new Error('usage: grant-platform-admin <email>');

  await connectMongo(config.mongoUri);
  try {
    const identities = new IdentityRepository();
    const grants = new PlatformGrantRepository();

    const identity = await identities.findByEmailLower('local', normalized);
    if (!identity) {
      // Don't echo the email (operator-supplied; keep it out of logs) — they know what they passed.
      throw new Error(
        'no local identity for the supplied email — the user must sign up / be created before being granted platform access',
      );
    }
    await grants.grant({ userId: identity.userId, role: 'platform_admin' });
    logger.log(`Granted platform_admin (user ${identity.userId}).`);
  } finally {
    await disconnectMongo();
  }
}

async function main(): Promise<void> {
  const logger = new Logger('grant-platform-admin');
  try {
    const email = argv[2];
    if (!email) {
      logger.error('usage: grant-platform-admin <email>');
      process.exit(1);
    }
    await grantPlatformAdmin(email, loadConfig(process.env), logger);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

function isMainModule(): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main();
}
