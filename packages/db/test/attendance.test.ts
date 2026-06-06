/**
 * Attendance repository tests (ADR-0014, scope §4.4) against a real Mongoose connection backed by
 * an in-memory MongoDB. Verifies tenant isolation flows through the repository AND that
 * `classesSinceLastPromotion` counts only the right member + discipline strictly after the `since`
 * date (the count that feeds the pure rank engine, ADR-0005). Requires a downloaded
 * `mongodb-memory-server` binary to run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttendanceModel, AttendanceRepository } from '../src/attendance.js';
import { MissingTenantContextError } from '../src/errors.js';
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
const repo = new AttendanceRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await AttendanceModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('attendances').deleteMany({});
});

describe('AttendanceRepository', () => {
  it('refuses to operate with no tenant context (ADR-0004)', async () => {
    await expect(repo.record({ memberId: 'm1', method: 'instructor' })).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('records and lists a check-in within the active tenant', async () => {
    const created = await runInTenantContext(ctx('t1'), () =>
      repo.record({
        memberId: 'm1',
        disciplineId: 'bjj',
        occurredAt: '2026-01-10T18:00:00.000Z',
        method: 'kiosk_pin',
      }),
    );
    expect(created.tenantId).toBe('t1');
    expect(created.memberId).toBe('m1');
    expect(created.occurredAt).toBe('2026-01-10T18:00:00.000Z');
    expect(created.method).toBe('kiosk_pin');

    const list = await runInTenantContext(ctx('t1'), () => repo.list({ memberId: 'm1' }));
    expect(list).toHaveLength(1);
    expect(list[0]?.disciplineId).toBe('bjj');
  });

  it("does not return another tenant's attendance", async () => {
    await runInTenantContext(ctx('t1'), () =>
      repo.record({ memberId: 'm1', disciplineId: 'bjj', method: 'instructor' }),
    );
    await runInTenantContext(ctx('t2'), () =>
      repo.record({ memberId: 'm1', disciplineId: 'bjj', method: 'instructor' }),
    );

    const t2List = await runInTenantContext(ctx('t2'), () => repo.list());
    expect(t2List).toHaveLength(1);
    expect(t2List[0]?.tenantId).toBe('t2');
  });

  it('classesSinceLastPromotion counts only the right member + discipline after the since date', async () => {
    const since = new Date('2026-03-01T00:00:00.000Z');
    await runInTenantContext(ctx('t1'), async () => {
      // m1 / bjj: two AFTER `since`, one ON/BEFORE (excluded — strict $gt).
      await repo.record({
        memberId: 'm1',
        disciplineId: 'bjj',
        occurredAt: '2026-03-05T18:00:00.000Z',
        method: 'instructor',
      });
      await repo.record({
        memberId: 'm1',
        disciplineId: 'bjj',
        occurredAt: '2026-03-20T18:00:00.000Z',
        method: 'instructor',
      });
      await repo.record({
        memberId: 'm1',
        disciplineId: 'bjj',
        occurredAt: '2026-02-01T18:00:00.000Z',
        method: 'instructor',
      });
      // Same member, DIFFERENT discipline — must not count.
      await repo.record({
        memberId: 'm1',
        disciplineId: 'judo',
        occurredAt: '2026-03-10T18:00:00.000Z',
        method: 'instructor',
      });
      // DIFFERENT member, same discipline — must not count.
      await repo.record({
        memberId: 'm2',
        disciplineId: 'bjj',
        occurredAt: '2026-03-15T18:00:00.000Z',
        method: 'instructor',
      });
    });

    const count = await runInTenantContext(ctx('t1'), () =>
      repo.classesSinceLastPromotion('m1', 'bjj', since),
    );
    expect(count).toBe(2);
  });

  it('classesSinceLastPromotion is tenant-isolated', async () => {
    const since = new Date('2026-03-01T00:00:00.000Z');
    await runInTenantContext(ctx('t1'), () =>
      repo.record({
        memberId: 'm1',
        disciplineId: 'bjj',
        occurredAt: '2026-03-05T18:00:00.000Z',
        method: 'instructor',
      }),
    );
    // Another tenant's matching rows must never be counted.
    const count = await runInTenantContext(ctx('t2'), () =>
      repo.classesSinceLastPromotion('m1', 'bjj', since),
    );
    expect(count).toBe(0);
  });
});
