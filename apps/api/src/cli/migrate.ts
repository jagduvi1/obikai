import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Logger } from '@nestjs/common';
import { type AppConfig, ConfigError, loadConfig } from '@obikai/config';
import { makeMigrateConfig } from '@obikai/db';
import migrateMongo from 'migrate-mongo';

/**
 * `obikai migrate` — apply pending database migrations (G1). Forward-only `migrate-mongo` migrations
 * live in `@obikai/db`'s `migrations/` dir; this runner ships in the api image so a self-host can apply
 * them with `docker compose exec api node dist/cli/migrate.js` (or wire it into an upgrade step).
 *
 * Idempotent: the `changelog` collection records what is applied and a `changelog_lock` collection
 * stops two runners racing (multi-replica safe), so re-running only applies what is new.
 */

/** Absolute path to the migrations bundled with @obikai/db — resolves in dev (packages/db/migrations)
 *  and in the image (node_modules/@obikai/db/migrations). The package `main` is dist/index.js, so the
 *  package root is two dirs up. `files` in @obikai/db ships the dir. */
export function resolveMigrationsDir(): string {
  const dbMain = createRequire(import.meta.url).resolve('@obikai/db'); // …/@obikai/db/dist/index.js
  return join(dirname(dirname(dbMain)), 'migrations');
}

export async function runMigrations(
  config: AppConfig,
  logger: Logger = new Logger('migrate'),
): Promise<string[]> {
  // makeMigrateConfig mirrors migrate-mongo's config shape; the runner supplies the import + the
  // absolute migrations dir (the only field that differs between dev and the deployed image).
  migrateMongo.config.set(
    makeMigrateConfig(config.mongoUri, {
      migrationsDir: resolveMigrationsDir(),
    }) as unknown as Parameters<typeof migrateMongo.config.set>[0],
  );
  const { db, client } = await migrateMongo.database.connect();
  try {
    const applied = await migrateMongo.up(db, client);
    if (applied.length === 0) logger.log('Database is up to date — no migrations to apply.');
    else logger.log(`Applied ${applied.length} migration(s): ${applied.join(', ')}`);
    return applied;
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const logger = new Logger('migrate');
  try {
    await runMigrations(loadConfig(process.env), logger);
  } catch (error) {
    logger.error(
      error instanceof ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error),
    );
    process.exit(1);
  }
}

/** Run only when invoked directly (`node dist/cli/migrate.js`), not when imported. */
function isMainModule(): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) void main();
