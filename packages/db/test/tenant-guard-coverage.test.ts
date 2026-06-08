/**
 * Fail-safe tenant-isolation coverage (GDPR Art. 5(1)(f)/32, ADR-0004). Tenant isolation is the
 * control that keeps one dojo's member PII invisible to another, but it is OPT-IN per schema
 * (`schema.plugin(tenantGuard)`). This test makes that fail-safe: it enumerates EVERY registered
 * Mongoose model and asserts each is either tenant-guarded (a query with no TenantContext throws
 * `MissingTenantContextError`) or in the small, explicit tenant-GLOBAL allow-list. A new PII model
 * that forgets the guard will surface here as an un-allow-listed "global" model and FAIL the build —
 * so cross-tenant PII can never silently leak through a missing `plugin(tenantGuard)` line.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// Importing the package index registers every model on the shared mongoose instance.
import '../src/index.js';
import { MissingTenantContextError } from '../src/errors.js';

/**
 * The ONLY collections that are intentionally tenant-global (not owned by any single tenant):
 * the identity/account plane (incl. password-reset tokens, keyed by the tenant-global userId), the
 * tenant registry, the platform plane, and the per-tenant-year invoice counter (reachable on the
 * issue path with an explicit {tenantId, year} filter). Everything else holds tenant-owned data and
 * MUST be guarded. Adding to this list is a deliberate decision.
 */
const TENANT_GLOBAL = new Set([
  'User',
  'Identity',
  'Session',
  'PasswordResetToken',
  'Tenant',
  'PlatformGrant',
  'PlatformAudit',
  'InvoiceCounter',
]);

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

/** True if a bare `find` with NO active TenantContext is rejected by the guard (i.e. the model is guarded). */
async function isGuarded(model: mongoose.Model<unknown>): Promise<boolean> {
  try {
    await model.find({}).limit(1).exec();
    return false; // resolved with no tenant context → no guard
  } catch (err) {
    if (err instanceof MissingTenantContextError) return true;
    throw err; // an unexpected error — surface it
  }
}

describe('tenant-guard coverage', () => {
  it('every model is tenant-guarded OR explicitly tenant-global (no silent cross-tenant leak)', async () => {
    const names = Object.keys(mongoose.models).sort();
    expect(names.length).toBeGreaterThan(10); // sanity: the index really registered the models

    const guarded: string[] = [];
    const global: string[] = [];
    for (const name of names) {
      ((await isGuarded(mongoose.models[name] as mongoose.Model<unknown>)) ? guarded : global).push(
        name,
      );
    }

    // The set of UNGUARDED models must be EXACTLY the documented tenant-global allow-list.
    expect(new Set(global)).toEqual(TENANT_GLOBAL);
    // And nothing in the allow-list is accidentally guarded (which would break its global access path).
    for (const name of TENANT_GLOBAL) expect(guarded).not.toContain(name);
  });
});
