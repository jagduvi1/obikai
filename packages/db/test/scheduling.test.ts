/**
 * Scheduling repository tests (ADR-0014) against an in-memory MongoDB. Verifies tenant isolation
 * flows through the repos, that occurrence materialization is idempotent (re-running the same
 * horizon creates no duplicates, leaving overrides intact), and that the per-occurrence/per-member
 * booking uniqueness holds. Requires a downloaded `mongodb-memory-server` binary to run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MissingTenantContextError } from '../src/errors.js';
import {
  BookingModel,
  BookingRepository,
  ClassOccurrenceModel,
  ClassOccurrenceRepository,
  ClassScheduleModel,
  ClassScheduleRepository,
  DuplicateBookingError,
  ProgramModel,
  ProgramRepository,
} from '../src/scheduling.js';
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
const programs = new ProgramRepository();
const schedules = new ClassScheduleRepository();
const occurrences = new ClassOccurrenceRepository();
const bookings = new BookingRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    ProgramModel.syncIndexes(),
    ClassScheduleModel.syncIndexes(),
    ClassOccurrenceModel.syncIndexes(),
    BookingModel.syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    mongoose.connection.collection('programs').deleteMany({}),
    mongoose.connection.collection('classschedules').deleteMany({}),
    mongoose.connection.collection('classoccurrences').deleteMany({}),
    mongoose.connection.collection('bookings').deleteMany({}),
  ]);
});

describe('ProgramRepository', () => {
  it('refuses to operate with no tenant context (ADR-0004)', async () => {
    await expect(programs.create({ name: 'BJJ', active: true })).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('creates and reads back a program within the active tenant', async () => {
    const created = await runInTenantContext(ctx('t1'), () =>
      programs.create({ name: 'Adults BJJ', active: true }),
    );
    expect(created.tenantId).toBe('t1');
    const found = await runInTenantContext(ctx('t1'), () => programs.findById(created.id));
    expect(found?.name).toBe('Adults BJJ');
  });

  it("does not return another tenant's programs", async () => {
    await runInTenantContext(ctx('t1'), () => programs.create({ name: 'A', active: true }));
    await runInTenantContext(ctx('t2'), () => programs.create({ name: 'B', active: true }));
    const t2 = await runInTenantContext(ctx('t2'), () => programs.list());
    expect(t2.map((p) => p.name)).toEqual(['B']);
  });
});

describe('ClassOccurrenceRepository.materialize', () => {
  it('is idempotent: re-materializing the same horizon creates no duplicates', async () => {
    const rows = [
      {
        scheduleId: 'sch1',
        programId: 'prog1',
        locationId: 'loc1',
        startsAt: '2026-06-01T16:00:00.000Z',
        endsAt: '2026-06-01T17:00:00.000Z',
        capacity: 10,
      },
      {
        scheduleId: 'sch1',
        programId: 'prog1',
        locationId: 'loc1',
        startsAt: '2026-06-03T16:00:00.000Z',
        endsAt: '2026-06-03T17:00:00.000Z',
        capacity: 10,
      },
    ];
    const first = await runInTenantContext(ctx('t1'), () => occurrences.materialize(rows));
    expect(first).toBe(2);
    const second = await runInTenantContext(ctx('t1'), () => occurrences.materialize(rows));
    expect(second).toBe(0);
    const all = await runInTenantContext(ctx('t1'), () => occurrences.list({ scheduleId: 'sch1' }));
    expect(all).toHaveLength(2);
  });

  it('issues ONE bulkWrite for the whole horizon, not N sequential upserts (M21)', async () => {
    const spy = vi.spyOn(ClassOccurrenceModel, 'bulkWrite');
    const rows = Array.from({ length: 5 }, (_, i) => ({
      scheduleId: 'sch1',
      programId: 'prog1',
      locationId: 'loc1',
      startsAt: `2026-06-0${i + 1}T16:00:00.000Z`,
      endsAt: `2026-06-0${i + 1}T17:00:00.000Z`,
      capacity: 10,
    }));
    const created = await runInTenantContext(ctx('t1'), () => occurrences.materialize(rows));
    expect(created).toBe(5);
    expect(spy).toHaveBeenCalledTimes(1); // a single round-trip regardless of horizon size
    spy.mockRestore();
  });

  it('leaves a per-occurrence cancellation intact when re-materialized (override survives §7)', async () => {
    const rows = [
      {
        scheduleId: 'sch1',
        programId: 'prog1',
        locationId: 'loc1',
        startsAt: '2026-06-01T16:00:00.000Z',
        endsAt: '2026-06-01T17:00:00.000Z',
        capacity: 10,
      },
    ];
    await runInTenantContext(ctx('t1'), () => occurrences.materialize(rows));
    const [occ] = await runInTenantContext(ctx('t1'), () => occurrences.list({}));
    await runInTenantContext(ctx('t1'), () => occurrences.setStatus(occ.id, 'cancelled'));
    await runInTenantContext(ctx('t1'), () => occurrences.materialize(rows));
    const again = await runInTenantContext(ctx('t1'), () => occurrences.findById(occ.id));
    expect(again?.status).toBe('cancelled');
  });

  it('lists occurrences in a date range, chronologically', async () => {
    await runInTenantContext(ctx('t1'), () =>
      occurrences.materialize([
        {
          scheduleId: 's',
          programId: 'p',
          locationId: 'loc1',
          startsAt: '2026-06-10T16:00:00.000Z',
          endsAt: '2026-06-10T17:00:00.000Z',
          capacity: 5,
        },
        {
          scheduleId: 's',
          programId: 'p',
          locationId: 'loc1',
          startsAt: '2026-06-02T16:00:00.000Z',
          endsAt: '2026-06-02T17:00:00.000Z',
          capacity: 5,
        },
      ]),
    );
    const inRange = await runInTenantContext(ctx('t1'), () =>
      occurrences.list({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-05T00:00:00.000Z' }),
    );
    expect(inRange.map((o) => o.startsAt)).toEqual(['2026-06-02T16:00:00.000Z']);
  });
});

describe('BookingRepository', () => {
  it('enforces one booking per member per occurrence (typed DuplicateBookingError, not raw 11000)', async () => {
    await runInTenantContext(ctx('t1'), () =>
      bookings.create({
        occurrenceId: 'occ1',
        memberId: 'm1',
        status: 'booked',
        bookedAt: '2026-06-06T00:00:00.000Z',
      }),
    );
    // The unique-index violation is translated to a typed, catchable error so the controller can
    // return 409 instead of a raw Mongo 500.
    await expect(
      runInTenantContext(ctx('t1'), () =>
        bookings.create({
          occurrenceId: 'occ1',
          memberId: 'm1',
          status: 'booked',
          bookedAt: '2026-06-06T01:00:00.000Z',
        }),
      ),
    ).rejects.toBeInstanceOf(DuplicateBookingError);
  });

  it('promoteIfWaitlisted promotes only a still-waitlisted booking (atomic CAS)', async () => {
    const wl = await runInTenantContext(ctx('t1'), () =>
      bookings.create({
        occurrenceId: 'occ1',
        memberId: 'm1',
        status: 'waitlisted',
        bookedAt: '2026-06-06T00:00:00.000Z',
      }),
    );
    // First claim wins → booked.
    const promoted = await runInTenantContext(ctx('t1'), () => bookings.promoteIfWaitlisted(wl.id));
    expect(promoted?.status).toBe('booked');
    // Second claim is a no-op (no longer waitlisted) → null. This is what stops two concurrent
    // cancels from both promoting the same booking.
    const again = await runInTenantContext(ctx('t1'), () => bookings.promoteIfWaitlisted(wl.id));
    expect(again).toBeNull();
  });

  it('counts booked seats and lists waitlist oldest-first', async () => {
    await runInTenantContext(ctx('t1'), () =>
      bookings.create({
        occurrenceId: 'occ1',
        memberId: 'm1',
        status: 'booked',
        bookedAt: '2026-06-06T00:00:00.000Z',
      }),
    );
    await runInTenantContext(ctx('t1'), () =>
      bookings.create({
        occurrenceId: 'occ1',
        memberId: 'm2',
        status: 'waitlisted',
        bookedAt: '2026-06-06T00:01:00.000Z',
      }),
    );
    await runInTenantContext(ctx('t1'), () =>
      bookings.create({
        occurrenceId: 'occ1',
        memberId: 'm3',
        status: 'waitlisted',
        bookedAt: '2026-06-06T00:02:00.000Z',
      }),
    );
    const booked = await runInTenantContext(ctx('t1'), () =>
      bookings.countByOccurrence('occ1', 'booked'),
    );
    expect(booked).toBe(1);
    const waitlist = await runInTenantContext(ctx('t1'), () =>
      bookings.listByOccurrence('occ1', { status: 'waitlisted' }),
    );
    expect(waitlist.map((b) => b.memberId)).toEqual(['m2', 'm3']);
  });
});
