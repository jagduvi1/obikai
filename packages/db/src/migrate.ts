/**
 * Migration configuration shape (ADR-0004). We use `migrate-mongo` to run forward-only migrations
 * in `packages/db/migrations`, but we do NOT take a runtime dependency on it here: this module only
 * exports a TYPED config object that `migrate-mongo` consumes, plus the signature for the helper
 * that fans a per-tenant migration out across all tenants. The runner (a thin script in `apps/*` or
 * a `migrate-mongo-config.cjs`) supplies the actual `migrate-mongo` import and the Mongo client.
 *
 * The two-axis deploy model (ADR-0002) means a single migration file may need to run once
 * (self-host / single tenancy) or once per tenant (hosted / multi). Cross-tenant migrations open
 * each tenant scope EXPLICITLY via `runInTenantContext` (or `runAsPlatform` for genuinely global
 * collections) — a migration that forgets to open a scope crashes on first tenant-owned access, by
 * design (see `tenant-context.ts`).
 */
import type { TenantContext } from './tenant-context.js';

/**
 * The subset of `migrate-mongo`'s config we pin. Mirrors `migrate-mongo`'s `config` object so a
 * `migrate-mongo-config.cjs` can simply `module.exports = makeMigrateConfig(...)`.
 */
export interface MigrateMongoConfig {
  readonly mongodb: {
    readonly url: string;
    readonly databaseName?: string;
    readonly options?: Record<string, unknown>;
  };
  /** Directory of migration files (relative to the runner CWD). */
  readonly migrationsDir: string;
  /** Collection that records applied migrations. */
  readonly changelogCollectionName: string;
  /** Lock collection so two runners cannot apply migrations concurrently. */
  readonly lockCollectionName: string;
  readonly lockTtl: number;
  /** File extension of migration modules (`.cjs` keeps them runnable without ESM transpile). */
  readonly migrationFileExtension: string;
  /** Hash migration contents so an edited, already-applied migration is detected. */
  readonly useFileHash: boolean;
  /** Module system migrate-mongo loads migrations as. */
  readonly moduleSystem: 'commonjs' | 'esm';
}

/** Sensible Obikai defaults for the migrate-mongo config; override `mongodb.url` per deployment. */
export function makeMigrateConfig(
  mongoUri: string,
  overrides: Partial<MigrateMongoConfig> = {},
): MigrateMongoConfig {
  return {
    mongodb: { url: mongoUri, options: {} },
    migrationsDir: 'packages/db/migrations',
    changelogCollectionName: 'changelog',
    lockCollectionName: 'changelog_lock',
    lockTtl: 0,
    migrationFileExtension: '.cjs',
    useFileHash: true,
    moduleSystem: 'commonjs',
    ...overrides,
  };
}

/**
 * The shape every migration module exports (forward-only `up`, optional `down`). `db` is the
 * native Mongo `Db` handle migrate-mongo passes; we keep it `unknown` so this package does not need
 * the mongodb driver types at build time — cast it in the migration file.
 */
export interface Migration {
  up(db: unknown, client?: unknown): Promise<void>;
  down?(db: unknown, client?: unknown): Promise<void>;
}

/**
 * Signature for the per-tenant fan-out helper (implemented by the runner, which owns the Mongo
 * connection and the tenant list). For each tenant it opens an explicit `TenantContext` via
 * `runInTenantContext` and invokes `fn`, so the guard scopes every operation `fn` performs.
 *
 * Example runner implementation outline (NOT exported here — lives in the app/worker):
 *
 * ```ts
 * export async function runForEachTenant(
 *   tenants: readonly TenantContext[],
 *   fn: (ctx: TenantContext) => Promise<void>,
 * ): Promise<void> {
 *   for (const ctx of tenants) {
 *     await runInTenantContext(ctx, () => fn(ctx));
 *   }
 * }
 * ```
 */
export type RunForEachTenant = (
  tenants: readonly TenantContext[],
  fn: (ctx: TenantContext) => Promise<void>,
) => Promise<void>;
