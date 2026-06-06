/**
 * Household repository tests (ADR-0011) against a real Mongoose connection backed by an in-memory
 * MongoDB. Verifies tenant isolation flows through the repository (create/findById/list/update) and
 * that `listMembers` returns only the active tenant's members linked to a household. Requires a
 * downloaded `mongodb-memory-server` binary to run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MissingTenantContextError } from '../src/errors.js';
import { HouseholdModel, HouseholdRepository } from '../src/household.js';
import { MemberModel, MemberRepository } from '../src/member.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'staff', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const households = new HouseholdRepository();
const members = new MemberRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await HouseholdModel.syncIndexes();
  await MemberModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('households').deleteMany({});
  await mongoose.connection.collection('members').deleteMany({});
});

describe('HouseholdRepository', () => {
  it('refuses to operate with no tenant context (ADR-0004)', async () => {
    await expect(households.create({ name: 'Tanaka Family' })).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('creates and reads back a household within the active tenant', async () => {
    const created = await runInTenantContext(ctx('t1'), () =>
      households.create({ name: 'Tanaka Family' }),
    );
    expect(created.tenantId).toBe('t1');
    const found = await runInTenantContext(ctx('t1'), () => households.findById(created.id));
    expect(found?.name).toBe('Tanaka Family');
  });

  it("does not return another tenant's households", async () => {
    const a = await runInTenantContext(ctx('t1'), () => households.create({ name: 'A Family' }));
    await runInTenantContext(ctx('t2'), () => households.create({ name: 'B Family' }));

    const t2List = await runInTenantContext(ctx('t2'), () => households.list());
    expect(t2List.map((h) => h.name)).toEqual(['B Family']);

    const crossRead = await runInTenantContext(ctx('t2'), () => households.findById(a.id));
    expect(crossRead).toBeNull();
  });

  it('updates the payer within the tenant', async () => {
    const h = await runInTenantContext(ctx('t1'), () => households.create({ name: 'C Family' }));
    const updated = await runInTenantContext(ctx('t1'), () =>
      households.update(h.id, { payerUserId: 'u-payer' }),
    );
    expect(updated?.payerUserId).toBe('u-payer');
  });

  it('lists only the tenant members linked to a household', async () => {
    const { household, linkedId } = await runInTenantContext(ctx('t1'), async () => {
      const household = await households.create({ name: 'Tanaka Family' });
      const linked = await members.create({
        firstName: 'Aiko',
        lastName: 'Tanaka',
        status: 'active',
        householdId: household.id,
      });
      // An unlinked member in the same tenant must NOT appear in the roster.
      await members.create({ firstName: 'Solo', lastName: 'Adult', status: 'active' });
      return { household, linkedId: linked.id };
    });

    const roster = await runInTenantContext(ctx('t1'), () => households.listMembers(household.id));
    expect(roster.map((m) => m.id)).toEqual([linkedId]);

    // Another tenant sees an empty roster for that household id.
    const crossRoster = await runInTenantContext(ctx('t2'), () =>
      households.listMembers(household.id),
    );
    expect(crossRoster).toEqual([]);
  });
});
