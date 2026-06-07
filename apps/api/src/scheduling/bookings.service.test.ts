import type { AuthzActor } from '@obikai/authz';
import type { Booking, BookingStatus, ClassOccurrence } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { BookingsService, type BookingsStore, type OccurrenceLookup } from './bookings.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from './scheduling.errors.js';

/** In-memory fake booking store — lets us unit-test capacity/waitlist logic without Nest or Mongo. */
class FakeBookingsStore implements BookingsStore {
  private readonly byId = new Map<string, Booking>();
  private seq = 0;

  async create(input: {
    occurrenceId: string;
    memberId: string;
    status: BookingStatus;
    bookedAt: string;
  }): Promise<Booking> {
    const id = `b${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const booking: Booking = {
      id: id as Booking['id'],
      tenantId: 't1' as Booking['tenantId'],
      occurrenceId: input.occurrenceId as Booking['occurrenceId'],
      memberId: input.memberId as Booking['memberId'],
      status: input.status,
      bookedAt: input.bookedAt,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, booking);
    return booking;
  }
  async findById(id: string): Promise<Booking | null> {
    return this.byId.get(id) ?? null;
  }
  async listByOccurrence(
    occurrenceId: string,
    opts: { status?: BookingStatus } = {},
  ): Promise<Booking[]> {
    return [...this.byId.values()]
      .filter((b) => b.occurrenceId === occurrenceId)
      .filter((b) => (opts.status ? b.status === opts.status : true))
      .sort((a, b) => a.bookedAt.localeCompare(b.bookedAt));
  }
  async countByOccurrence(occurrenceId: string, status: BookingStatus): Promise<number> {
    return (await this.listByOccurrence(occurrenceId, { status })).length;
  }
  async setStatus(id: string, status: BookingStatus): Promise<Booking | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, status };
    this.byId.set(id, next);
    return next;
  }
  // Atomic CAS mirror of BookingRepository.promoteIfWaitlisted: promote ONLY if still waitlisted.
  async promoteIfWaitlisted(id: string): Promise<Booking | null> {
    const cur = this.byId.get(id);
    if (!cur || cur.status !== 'waitlisted') return null;
    const next = { ...cur, status: 'booked' as BookingStatus };
    this.byId.set(id, next);
    return next;
  }
}

/** A single fixed occurrence with configurable capacity/status. */
function occurrenceLookup(occ: ClassOccurrence): OccurrenceLookup {
  return {
    async findById(id: string) {
      return id === occ.id ? occ : null;
    },
  };
}

const occ = (over: Partial<ClassOccurrence> = {}): ClassOccurrence => ({
  id: 'occ1' as ClassOccurrence['id'],
  tenantId: 't1' as ClassOccurrence['tenantId'],
  scheduleId: 'sch1' as ClassOccurrence['scheduleId'],
  programId: 'prog1' as ClassOccurrence['programId'],
  locationId: 'loc1' as ClassOccurrence['locationId'],
  startsAt: '2026-06-10T16:00:00.000Z',
  endsAt: '2026-06-10T17:00:00.000Z',
  capacity: 2,
  status: 'scheduled',
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
  ...over,
});

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });
const bareMember = actor({
  userId: 'u9',
  memberId: 'm9',
  roles: [{ role: 'member', locationScope: 'ALL' }],
});

describe('BookingsService capacity + waitlist', () => {
  let store: FakeBookingsStore;
  let svc: BookingsService;
  beforeEach(() => {
    store = new FakeBookingsStore();
    svc = new BookingsService(store, occurrenceLookup(occ({ capacity: 2 })));
  });

  it('books up to capacity, then waitlists', async () => {
    const a = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' });
    const b = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm2' });
    const c = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm3' });
    expect(a.status).toBe('booked');
    expect(b.status).toBe('booked');
    expect(c.status).toBe('waitlisted');
  });

  it('promotes the oldest waitlisted booking when a booked seat is cancelled', async () => {
    await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' }); // booked
    const second = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm2' }); // booked
    const third = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm3' }); // waitlisted (older)
    const fourth = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm4' }); // waitlisted (newer)
    expect(third.status).toBe('waitlisted');
    expect(fourth.status).toBe('waitlisted');

    await svc.cancel(staff, second.id);

    // Oldest waitlisted (m3) promoted; m4 still waiting.
    const promoted = await store.findById(third.id);
    const stillWaiting = await store.findById(fourth.id);
    expect(promoted?.status).toBe('booked');
    expect(stillWaiting?.status).toBe('waitlisted');
  });

  it('advances past a waitlisted candidate already claimed by a concurrent cancel (M22)', async () => {
    // 2 booked, 2 waitlisted (m3 oldest, m4 next).
    await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' });
    const second = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm2' });
    const third = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm3' });
    const fourth = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm4' });

    // Simulate a concurrent cancel having grabbed the oldest waitlisted (m3) AFTER we list it but
    // BEFORE we claim it: the first CAS on m3 loses (returns null). The loop must then claim m4 —
    // not silently leave the freed seat unfilled (the old unconditional setStatus bug).
    const realPromote = store.promoteIfWaitlisted.bind(store);
    let lostOnce = false;
    store.promoteIfWaitlisted = async (id: string) => {
      if (!lostOnce && id === third.id) {
        lostOnce = true;
        return null; // lost the race for m3
      }
      return realPromote(id);
    };

    await svc.cancel(staff, second.id);

    // m4 inherited the freed seat; nobody was double-promoted and no seat was lost.
    expect((await store.findById(fourth.id))?.status).toBe('booked');
    expect((await store.findById(third.id))?.status).toBe('waitlisted');
  });

  it('does not promote anyone when cancelling a waitlisted booking', async () => {
    await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' }); // booked
    await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm2' }); // booked
    const third = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm3' }); // waitlisted
    const fourth = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm4' }); // waitlisted

    await svc.cancel(staff, third.id);

    const stillWaiting = await store.findById(fourth.id);
    expect(stillWaiting?.status).toBe('waitlisted');
  });

  it('rejects a duplicate live booking for the same member/occurrence', async () => {
    await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' });
    await expect(
      svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rebooking after a cancellation is allowed', async () => {
    const a = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' });
    await svc.cancel(staff, a.id);
    const again = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' });
    expect(again.status).toBe('booked');
  });
});

describe('BookingsService RBAC + self-access', () => {
  let store: FakeBookingsStore;
  let svc: BookingsService;
  beforeEach(() => {
    store = new FakeBookingsStore();
    svc = new BookingsService(store, occurrenceLookup(occ({ capacity: 5 })));
  });

  it('lets a member book THEMSELVES (self-access)', async () => {
    const created = await svc.create(bareMember, { occurrenceId: 'occ1', memberId: 'm9' });
    expect(created.status).toBe('booked');
  });

  it('forbids a member booking someone else', async () => {
    await expect(
      svc.create(bareMember, { occurrenceId: 'occ1', memberId: 'someone-else' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a member cancel their OWN booking but not another member’s', async () => {
    const mine = await svc.create(bareMember, { occurrenceId: 'occ1', memberId: 'm9' });
    const theirs = await svc.create(staff, { occurrenceId: 'occ1', memberId: 'm2' });
    await expect(svc.cancel(bareMember, theirs.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.cancel(bareMember, mine.id)).resolves.toBeDefined();
  });

  it('404s cancelling a missing booking', async () => {
    await expect(svc.cancel(staff, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects booking a cancelled occurrence', async () => {
    const cancelledSvc = new BookingsService(store, occurrenceLookup(occ({ status: 'cancelled' })));
    await expect(
      cancelledSvc.create(staff, { occurrenceId: 'occ1', memberId: 'm1' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
