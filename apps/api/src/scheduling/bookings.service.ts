import { type AuthzActor, can } from '@obikai/authz';
import type { Booking, BookingCreateInput, BookingStatus, ClassOccurrence } from '@obikai/domain';
import { ConflictError, ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * BookingsService — reserve a member onto a ClassOccurrence with a waitlist (scope §4.3, ADR-0014).
 * Framework-free. Authorization: staff (RBAC resource 'class') may book/cancel anyone; a member may
 * book/cancel THEMSELVES via self-access (`actor.memberId === booking.memberId`), independent of the
 * role catalog. Capacity is enforced at booking time: a full occurrence puts the member on the
 * waitlist; cancelling a 'booked' seat promotes the oldest waitlisted booking.
 */

/** The occurrence lookup the booking flow needs (capacity + cancelled-state guard). */
export interface OccurrenceLookup {
  findById(id: string): Promise<ClassOccurrence | null>;
}

/** The persistence surface BookingsService needs — satisfied by @obikai/db's BookingRepository. */
export interface BookingsStore {
  create(input: {
    occurrenceId: string;
    memberId: string;
    status: BookingStatus;
    bookedAt: string;
  }): Promise<Booking>;
  findById(id: string): Promise<Booking | null>;
  listByOccurrence(occurrenceId: string, opts?: { status?: BookingStatus }): Promise<Booking[]>;
  countByOccurrence(occurrenceId: string, status: BookingStatus): Promise<number>;
  setStatus(id: string, status: BookingStatus): Promise<Booking | null>;
}

export class BookingsService {
  constructor(
    private readonly store: BookingsStore,
    private readonly occurrences: OccurrenceLookup,
  ) {}

  /**
   * Authorize a booking action on `memberId`: staff via RBAC 'class', or the member acting on their
   * own booking (self-access). `action` is the RBAC action staff need for the operation.
   */
  private authorize(actor: AuthzActor, memberId: string, action: 'create' | 'update'): void {
    const selfService = actor.memberId !== undefined && actor.memberId === memberId;
    if (selfService) return;
    if (!can(actor, { resource: 'class', action })) throw new ForbiddenError(action, 'class');
  }

  /** Book a member onto an occurrence: 'booked' if capacity remains, else 'waitlisted'. */
  async create(actor: AuthzActor, input: BookingCreateInput): Promise<Booking> {
    this.authorize(actor, input.memberId, 'create');

    const occurrence = await this.occurrences.findById(input.occurrenceId);
    if (!occurrence) throw new NotFoundError('occurrence', input.occurrenceId);
    if (occurrence.status === 'cancelled') {
      throw new ConflictError(`occurrence is cancelled: ${input.occurrenceId}`);
    }

    // One booking per member per occurrence: surface an existing live booking as a conflict.
    const existing = (await this.store.listByOccurrence(input.occurrenceId)).find(
      (b) => b.memberId === input.memberId && b.status !== 'cancelled',
    );
    if (existing) {
      throw new ConflictError(
        `member ${input.memberId} already booked occurrence ${input.occurrenceId}`,
      );
    }

    const bookedCount = await this.store.countByOccurrence(input.occurrenceId, 'booked');
    const status: BookingStatus = bookedCount < occurrence.capacity ? 'booked' : 'waitlisted';

    return this.store.create({
      occurrenceId: input.occurrenceId,
      memberId: input.memberId,
      status,
      bookedAt: new Date().toISOString(),
    });
  }

  /**
   * Cancel a booking. If it was a 'booked' seat, promote the oldest 'waitlisted' booking on the
   * same occurrence to 'booked' (FIFO by bookedAt).
   */
  async cancel(actor: AuthzActor, id: string): Promise<Booking> {
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('booking', id);
    this.authorize(actor, existing.memberId, 'update');

    if (existing.status === 'cancelled') return existing;

    const freedSeat = existing.status === 'booked';
    const cancelled = await this.store.setStatus(id, 'cancelled');
    if (!cancelled) throw new NotFoundError('booking', id);

    if (freedSeat) {
      // Oldest waitlisted booking inherits the freed seat (listByOccurrence is bookedAt-ascending).
      const [next] = await this.store.listByOccurrence(existing.occurrenceId, {
        status: 'waitlisted',
      });
      if (next) await this.store.setStatus(next.id, 'booked');
    }

    return cancelled;
  }

  async listByOccurrence(actor: AuthzActor, occurrenceId: string): Promise<Booking[]> {
    if (!can(actor, { resource: 'class', action: 'list' }))
      throw new ForbiddenError('list', 'class');
    return this.store.listByOccurrence(occurrenceId);
  }
}
