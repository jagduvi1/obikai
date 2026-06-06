/**
 * Member repository tests (ADR-0011) against a real Mongoose connection backed by an in-memory
 * MongoDB. Verifies tenant isolation flows through the repository AND that email uniqueness is
 * per-tenant (two dojos may share an email; one dojo may not duplicate it). Requires a downloaded
 * `mongodb-memory-server` binary to run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MissingTenantContextError } from '../src/errors.js';
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
const repo = new MemberRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await MemberModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('members').deleteMany({});
});

describe('MemberRepository', () => {
  it('refuses to operate with no tenant context (ADR-0004)', async () => {
    await expect(
      repo.create({ firstName: 'A', lastName: 'B', status: 'lead' }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it('creates and reads back a member within the active tenant', async () => {
    const created = await runInTenantContext(ctx('t1'), () =>
      repo.create({
        firstName: 'Aiko',
        lastName: 'Tanaka',
        status: 'active',
        email: 'aiko@example.com',
      }),
    );
    expect(created.tenantId).toBe('t1');
    expect(created.email).toBe('aiko@example.com');

    const found = await runInTenantContext(ctx('t1'), () => repo.findById(created.id));
    expect(found?.firstName).toBe('Aiko');
  });

  it("does not return another tenant's members", async () => {
    const a = await runInTenantContext(ctx('t1'), () =>
      repo.create({ firstName: 'A', lastName: 'One', status: 'active' }),
    );
    await runInTenantContext(ctx('t2'), () =>
      repo.create({ firstName: 'B', lastName: 'Two', status: 'active' }),
    );

    const t2List = await runInTenantContext(ctx('t2'), () => repo.list());
    expect(t2List.map((m) => m.firstName)).toEqual(['B']);

    const crossRead = await runInTenantContext(ctx('t2'), () => repo.findById(a.id));
    expect(crossRead).toBeNull();
  });

  it('enforces per-tenant unique email but allows the same email across tenants', async () => {
    await runInTenantContext(ctx('t1'), () =>
      repo.create({ firstName: 'A', lastName: 'One', status: 'active', email: 'dup@example.com' }),
    );
    // Same email, same tenant → rejected by the unique index.
    await expect(
      runInTenantContext(ctx('t1'), () =>
        repo.create({
          firstName: 'C',
          lastName: 'Three',
          status: 'active',
          email: 'dup@example.com',
        }),
      ),
    ).rejects.toThrow();
    // Same email, DIFFERENT tenant → allowed.
    const other = await runInTenantContext(ctx('t2'), () =>
      repo.create({ firstName: 'D', lastName: 'Four', status: 'active', email: 'dup@example.com' }),
    );
    expect(other.email).toBe('dup@example.com');
  });

  it('updates and deletes within the tenant', async () => {
    const m = await runInTenantContext(ctx('t1'), () =>
      repo.create({ firstName: 'E', lastName: 'Five', status: 'lead' }),
    );
    const updated = await runInTenantContext(ctx('t1'), () =>
      repo.update(m.id, { status: 'active' }),
    );
    expect(updated?.status).toBe('active');
    const removed = await runInTenantContext(ctx('t1'), () => repo.remove(m.id));
    expect(removed).toBe(true);
    const gone = await runInTenantContext(ctx('t1'), () => repo.findById(m.id));
    expect(gone).toBeNull();
  });
});
