/**
 * Billing-profile persistence tests (ADR-0018). Verifies the seller profile IS tenant-scoped
 * (guarded — unlike the tenant-global registry), behaves as a per-tenant singleton (upsert replaces,
 * never duplicates), and never leaks across tenants. Requires a downloaded mongodb-memory-server.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BillingProfileModel, BillingProfileRepository } from '../src/billing-profile.js';
import { MissingTenantContextError } from '../src/errors.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: null,
  roles: [{ role: 'owner', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const repo = new BillingProfileRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await BillingProfileModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('billingprofiles').deleteMany({});
});

describe('billing profile is tenant-scoped (guarded, ADR-0004/0018)', () => {
  it('the schema HAS a tenantId path (it is tenant-OWNED config, not the registry)', () => {
    expect(BillingProfileModel.schema.path('tenantId')).toBeDefined();
  });

  it('refuses to read or write with no tenant context', async () => {
    await expect(repo.get()).rejects.toBeInstanceOf(MissingTenantContextError);
    await expect(repo.upsert({ legalName: 'X' })).rejects.toBeInstanceOf(MissingTenantContextError);
  });
});

describe('singleton upsert', () => {
  it('creates then returns the profile', async () => {
    await runInTenantContext(ctx('t1'), async () => {
      expect(await repo.get()).toBeNull();
      const saved = await repo.upsert({
        legalName: 'Aikido Sthlm AB',
        vatId: 'SE1',
        country: 'SE',
      });
      expect(saved.legalName).toBe('Aikido Sthlm AB');
      expect(saved.vatId).toBe('SE1');
      expect((await repo.get())?.legalName).toBe('Aikido Sthlm AB');
    });
  });

  it('replaces in place (one doc per tenant) and clears omitted fields to null', async () => {
    await runInTenantContext(ctx('t1'), async () => {
      await repo.upsert({ legalName: 'First', vatId: 'SE1' });
      const updated = await repo.upsert({ legalName: 'Second' });
      expect(updated.legalName).toBe('Second');
      // vatId omitted on the second upsert → cleared to null (PUT semantics).
      expect(updated.vatId).toBeNull();
    });
    const count = await mongoose.connection
      .collection('billingprofiles')
      .countDocuments({ tenantId: 't1' });
    expect(count).toBe(1);
  });
});

describe('tenant isolation', () => {
  it('never returns another tenant the profile', async () => {
    await runInTenantContext(ctx('t1'), () => repo.upsert({ legalName: 'Tenant One' }));
    await runInTenantContext(ctx('t2'), () => repo.upsert({ legalName: 'Tenant Two' }));

    const inT1 = await runInTenantContext(ctx('t1'), () => repo.get());
    const inT2 = await runInTenantContext(ctx('t2'), () => repo.get());
    const inT3 = await runInTenantContext(ctx('t3'), () => repo.get());

    expect(inT1?.legalName).toBe('Tenant One');
    expect(inT2?.legalName).toBe('Tenant Two');
    expect(inT3).toBeNull();
  });
});
