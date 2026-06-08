import type { AuthzActor } from '@obikai/authz';
import type {
  Attendance,
  AttendanceCreateInput,
  Booking,
  ClassOccurrence,
  Program,
} from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from './attendance.service.js';
import {
  type AttendanceCheckInStore,
  type BookingLookup,
  CheckInClosedError,
  CheckInService,
  NotBookedError,
  OccurrenceCancelledError,
  type OccurrenceLookup,
  type ProgramLookup,
} from './check-in.service.js';

/** Records every attendance write + serves the idempotency lookup. */
class FakeAttendanceStore implements AttendanceCheckInStore {
  readonly recorded: AttendanceCreateInput[] = [];
  existing: Attendance | null = null;
  async record(input: AttendanceCreateInput): Promise<Attendance> {
    this.recorded.push(input);
    return { id: 'a1', ...input } as unknown as Attendance;
  }
  async findByMemberOccurrence(): Promise<Attendance | null> {
    return this.existing;
  }
}

const occurrence = (over: Partial<ClassOccurrence> = {}): ClassOccurrence =>
  ({
    id: 'occ1',
    tenantId: 't1',
    scheduleId: 'sch1',
    programId: 'prog1',
    locationId: 'loc1',
    startsAt: '2026-06-10T16:00:00.000Z',
    endsAt: '2026-06-10T17:00:00.000Z',
    capacity: 10,
    status: 'scheduled',
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...over,
  }) as ClassOccurrence;

const occurrenceLookup = (occ: ClassOccurrence | null): OccurrenceLookup => ({
  async findById() {
    return occ;
  },
});
const programLookup = (disciplineId: string | null): ProgramLookup => ({
  async findById() {
    return { id: 'prog1', disciplineId } as Program;
  },
});
const bookingLookup = (booking: Booking | null): BookingLookup => ({
  async findByMemberOccurrence() {
    return booking;
  },
});

const booking = (status: Booking['status'] = 'booked'): Booking =>
  ({ id: 'b1', memberId: 'm1', occurrenceId: 'occ1', status }) as Booking;

const member: AuthzActor = { userId: 'u1', memberId: 'm1', roles: [] };
const staff: AuthzActor = { userId: 'u2', roles: [{ role: 'staff', locationScope: 'ALL' }] };

// During the class (16:00–17:00): inside the 15:00–18:00 check-in window.
const duringClass = () => new Date('2026-06-10T16:30:00.000Z');

function build(opts: {
  store?: FakeAttendanceStore;
  occ?: ClassOccurrence | null;
  discipline?: string | null;
  booking?: Booking | null;
  now?: () => Date;
}) {
  const store = opts.store ?? new FakeAttendanceStore();
  const svc = new CheckInService(
    store,
    occurrenceLookup(opts.occ === undefined ? occurrence() : opts.occ),
    programLookup(opts.discipline === undefined ? 'disc-bjj' : opts.discipline),
    bookingLookup(opts.booking === undefined ? booking() : opts.booking),
    opts.now ?? duringClass,
  );
  return { store, svc };
}

describe('CheckInService.selfCheckIn', () => {
  let store: FakeAttendanceStore;
  beforeEach(() => {
    store = new FakeAttendanceStore();
  });

  it('records a self check-in with the program’s discipline when booked + in window', async () => {
    const { svc } = build({ store });
    const att = await svc.selfCheckIn(member, 'occ1');
    expect(store.recorded).toHaveLength(1);
    expect(store.recorded[0]).toMatchObject({
      memberId: 'm1',
      occurrenceId: 'occ1',
      programId: 'prog1',
      disciplineId: 'disc-bjj',
      locationId: 'loc1',
      method: 'self',
    });
    expect(att).toBeDefined();
  });

  it('forbids a non-member actor (staff use the roster path)', async () => {
    const { svc } = build({ store });
    await expect(svc.selfCheckIn(staff, 'occ1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.recorded).toHaveLength(0);
  });

  it('404s an unknown occurrence', async () => {
    const { svc } = build({ store, occ: null });
    await expect(svc.selfCheckIn(member, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a cancelled occurrence (409)', async () => {
    const { svc } = build({ store, occ: occurrence({ status: 'cancelled' }) });
    await expect(svc.selfCheckIn(member, 'occ1')).rejects.toBeInstanceOf(OccurrenceCancelledError);
  });

  it('rejects check-in before the window opens and after it closes', async () => {
    const tooEarly = build({ store, now: () => new Date('2026-06-10T14:00:00.000Z') });
    await expect(tooEarly.svc.selfCheckIn(member, 'occ1')).rejects.toBeInstanceOf(
      CheckInClosedError,
    );
    const tooLate = build({ now: () => new Date('2026-06-10T19:00:00.000Z') });
    await expect(tooLate.svc.selfCheckIn(member, 'occ1')).rejects.toBeInstanceOf(
      CheckInClosedError,
    );
  });

  it('rejects a member who is not booked (or whose booking is cancelled)', async () => {
    await expect(
      build({ store, booking: null }).svc.selfCheckIn(member, 'occ1'),
    ).rejects.toBeInstanceOf(NotBookedError);
    await expect(
      build({ booking: booking('cancelled') }).svc.selfCheckIn(member, 'occ1'),
    ).rejects.toBeInstanceOf(NotBookedError);
  });

  it('is idempotent — a second tap returns the existing row, never a duplicate', async () => {
    store.existing = { id: 'a-existing', memberId: 'm1' } as unknown as Attendance;
    const { svc } = build({ store });
    const att = await svc.selfCheckIn(member, 'occ1');
    expect(att.id).toBe('a-existing');
    expect(store.recorded).toHaveLength(0);
  });

  it('records with a null discipline when the program has none (no crash)', async () => {
    const { svc } = build({ store, discipline: null });
    await svc.selfCheckIn(member, 'occ1');
    expect(store.recorded[0]).toMatchObject({ disciplineId: null, method: 'self' });
  });
});
