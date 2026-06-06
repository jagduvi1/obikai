import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { type AppConfig, ConfigError, loadConfig } from '@obikai/config';

/**
 * `obikai create-owner` — email-independent first-run owner bootstrap (ADR-0009). A first-boot
 * SMTP misconfiguration must never lock out the only admin, so the owner can be seeded directly
 * from BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD (surfaced by @obikai/config as
 * `config.bootstrapOwner`) with no email round-trip.
 *
 * STUB: this currently validates config and logs the intended action. The DB write (idempotent
 * upsert of an owner User + Membership, argon2id-hashed password) lands once @obikai/db exposes
 * the repositories. Kept side-effect-free so it is safe to run during scaffolding.
 */
export function createOwner(config: AppConfig, logger: Logger = new Logger('create-owner')): void {
  const owner = config.bootstrapOwner;
  if (owner === null) {
    logger.warn('BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD not set — nothing to bootstrap.');
    return;
  }

  // Never log the password; report intent only.
  logger.log(`Would bootstrap owner account for <${owner.email}> (db write not yet implemented).`);
}

/** Load config (fail-fast) then run the bootstrap. Separated so tests can call createOwner directly. */
function main(): void {
  const logger = new Logger('create-owner');
  try {
    const config = loadConfig(process.env);
    createOwner(config, logger);
  } catch (error) {
    if (error instanceof ConfigError) {
      logger.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

/** Run only when invoked directly (`node dist/cli/create-owner.js`), not when imported. This is
 * the ESM/NodeNext equivalent of the `import.meta.main` guard. */
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
  main();
}
