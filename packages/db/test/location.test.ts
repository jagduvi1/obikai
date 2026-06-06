/**
 * Location repository tests (scope §4.10, ADR-0011) against a real Mongoose connection backed by an
 * in-memory MongoDB. Verifies tenant isolation flows through the repository: one tenant never sees
 * another tenant's locations, and the repository refuses to operate with no tenant context.
 * Requires a downloaded `mongodb-memory-server` binary to run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MissingTenantContextError } from '../src/errors.js';
import { LocationModel, LocationRepository } from '../src/location.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'owner', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const repo = new LocationRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await LocationModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('locations').deleteMany({});
});

describe('LocationRepository', () => {
  it('refuses to operate with no tenant context (ADR-0004)', async () => {
    await expect(
      repo.create({ name: 'Dojo HQ', timezone: 'Europe/Stockholm' }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it('creates and reads back a location within the active tenant', async () => {
    const created = await runInTenantContext(ctx('t1'), () =>
      repo.create({ name: 'Dojo HQ', timezone: 'Europe/Stockholm', address: 'Main St 1' }),
    );
    expect(created.tenantId).toBe('t1');
    expect(created.name).toBe('Dojo HQ');
    expect(created.timezone).toBe('Europe/Stockholm');
    expect(created.address).toBe('Main St 1');

    const found = await runInTenantContext(ctx('t1'), () => repo.findById(created.id));
    expect(found?.name).toBe('Dojo HQ');
  });

  it("does not return another tenant's locations", async () => {
    const a = await runInTenantContext(ctx('t1'), () =>
      repo.create({ name: 'North', timezone: 'Europe/Stockholm' }),
    );
    await runInTenantContext(ctx('t2'), () =>
      repo.create({ name: 'South', timezone: 'Europe/Stockholm' }),
    );

    const t2List = await runInTenantContext(ctx('t2'), () => repo.list());
    expect(t2List.map((l) => l.name)).toEqual(['South']);

    const crossRead = await runInTenantContext(ctx('t2'), () => repo.findById(a.id));
    expect(crossRead).toBeNull();
  });

  it('updates within the tenant', async () => {
    const l = await runInTenantContext(ctx('t1'), () =>
      repo.create({ name: 'Old Name', timezone: 'Europe/Stockholm' }),
    );
    const updated = await runInTenantContext(ctx('t1'), () =>
      repo.update(l.id, { name: 'New Name', timezone: 'Europe/Helsinki' }),
    );
    expect(updated?.name).toBe('New Name');
    expect(updated?.timezone).toBe('Europe/Helsinki');

    const reread = await runInTenantContext(ctx('t1'), () => repo.findById(l.id));
    expect(reread?.name).toBe('New Name');
  });

  it("does not update another tenant's location", async () => {
    const a = await runInTenantContext(ctx('t1'), () =>
      repo.create({ name: 'T1 only', timezone: 'Europe/Stockholm' }),
    );
    const crossUpdate = await runInTenantContext(ctx('t2'), () =>
      repo.update(a.id, { name: 'hijacked' }),
    );
    expect(crossUpdate).toBeNull();
  });
});
