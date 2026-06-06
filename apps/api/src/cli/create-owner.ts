import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { hashPassword } from '@obikai/adapter-auth-local';
import { type AppConfig, ConfigError, loadConfig } from '@obikai/config';
import {
  IdentityRepository,
  MembershipRepository,
  type TenantContext,
  UserRepository,
  connectMongo,
  disconnectMongo,
  runInTenantContext,
} from '@obikai/db';

/**
 * `obikai create-owner` — email-independent first-run owner bootstrap (ADR-0009/0012). A first-boot
 * SMTP misconfiguration must never lock out the only admin, so the owner is seeded directly from
 * BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD with no email round-trip. Idempotent: re-running
 * reuses an existing identity and only adds the owner Membership if missing. Single-tenant self-host
 * only (the hosted plane onboards owners via signup + payment).
 */
export async function createOwner(
  config: AppConfig,
  logger: Logger = new Logger('create-owner'),
): Promise<void> {
  const owner = config.bootstrapOwner;
  if (owner === null) {
    logger.warn('BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD not set — nothing to bootstrap.');
    return;
  }
  if (config.tenancy !== 'single' || config.selfHostTenantSlug === null) {
    throw new Error('create-owner is only for single-tenant self-host');
  }
  const tenantId = config.selfHostTenantSlug;

  await connectMongo(config.mongoUri);
  try {
    const users = new UserRepository();
    const identities = new IdentityRepository();
    const memberships = new MembershipRepository();

    const normalized = owner.email.trim().toLowerCase();
    const existing = await identities.findByEmailLower('local', normalized);

    let userId: string;
    if (existing) {
      userId = existing.userId;
      logger.log(`Reusing existing identity for <${owner.email}>.`);
    } else {
      const user = await users.create({ email: owner.email, emailVerified: true });
      await identities.create({
        userId: user.id,
        provider: 'local',
        email: owner.email,
        passwordHash: hashPassword(owner.password),
        emailVerified: true,
      });
      userId = user.id;
      logger.log(`Created owner identity for <${owner.email}>.`);
    }

    const context: TenantContext = {
      tenantId,
      userId,
      sessionId: null,
      roles: [{ role: 'owner', locationScope: 'ALL' }],
      memberId: null,
      requestId: 'create-owner',
      tenancy: 'single',
    };
    await runInTenantContext(context, async () => {
      const current = await memberships.findByUserId(userId);
      if (current) {
        logger.log('Owner membership already exists — nothing to do.');
        return;
      }
      await memberships.create({
        userId,
        roles: [{ role: 'owner', locationScope: 'ALL' }],
        status: 'active',
      });
      logger.log(`Granted owner role in tenant "${tenantId}".`);
    });
  } finally {
    await disconnectMongo();
  }
}

/** Load config (fail-fast) then run the bootstrap. Separated so tests can call createOwner directly. */
async function main(): Promise<void> {
  const logger = new Logger('create-owner');
  try {
    const config = loadConfig(process.env);
    await createOwner(config, logger);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** Run only when invoked directly (`node dist/cli/create-owner.js`), not when imported. */
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
