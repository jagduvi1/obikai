import type { AuthzActor } from '@obikai/authz';
import type {
  Attendance,
  AttendanceCreateInput,
  Booking,
  ClassOccurrence,
  Program,
} from '@obikai/domain';
import { ForbiddenError, NotFoundError } from './attendance.service.js';

/**
 * CheckInService — member SELF check-in (scope §4.4 differentiator). A member taps "check in" for a
 * class they are booked into and that is happening now; we record an immutable attendance row with
 * `method: 'self'`, which feeds the rank engine's "classes since last promotion" exactly like an
 * instructor-marked check-in. It composes the attendance + scheduling repositories rather than living
 * in AttendanceService (which stays a pure attendance surface).
 *
 * The guard is deliberately strict — a member may only check IN THEMSELVES, only into a class they
 * actually booked, and only inside the check-in window. Idempotent: a double tap returns the existing
 * row, never a duplicate.
 */

/** Check-in opens this long BEFORE the class starts and closes this long AFTER it ends. */
export const CHECK_IN_LEAD_MS = 60 * 60 * 1000; // 60 min early
export const CHECK_IN_GRACE_MS = 60 * 60 * 1000; // 60 min after the end

export class CheckInClosedError extends Error {
  constructor() {
    super('check-in is not open for this class');
    this.name = 'CheckInClosedError';
  }
}
export class NotBookedError extends Error {
  constructor() {
    super('you are not booked into this class');
    this.name = 'NotBookedError';
  }
}
export class OccurrenceCancelledError extends Error {
  constructor() {
    super('this class is cancelled');
    this.name = 'OccurrenceCancelledError';
  }
}

export interface AttendanceCheckInStore {
  record(input: AttendanceCreateInput): Promise<Attendance>;
  findByMemberOccurrence(memberId: string, occurrenceId: string): Promise<Attendance | null>;
}
export interface OccurrenceLookup {
  findById(id: string): Promise<ClassOccurrence | null>;
}
export interface ProgramLookup {
  findById(id: string): Promise<Program | null>;
}
export interface BookingLookup {
  findByMemberOccurrence(memberId: string, occurrenceId: string): Promise<Booking | null>;
}

export class CheckInService {
  constructor(
    private readonly attendance: AttendanceCheckInStore,
    private readonly occurrences: OccurrenceLookup,
    private readonly programs: ProgramLookup,
    private readonly bookings: BookingLookup,
    /** Injectable clock for deterministic window tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Record the logged-in member's self check-in for `occurrenceId`. */
  async selfCheckIn(actor: AuthzActor, occurrenceId: string): Promise<Attendance> {
    const memberId = actor.memberId;
    // Self check-in means the actor checks in AS themselves; a non-member actor has no member to
    // check in (staff record attendance via the roster path, not this endpoint).
    if (memberId === undefined) throw new ForbiddenError('create', 'attendance');

    const occurrence = await this.occurrences.findById(occurrenceId);
    if (!occurrence) throw new NotFoundError('occurrence', occurrenceId);
    if (occurrence.status === 'cancelled') throw new OccurrenceCancelledError();

    const nowMs = this.now().getTime();
    const opensAt = Date.parse(occurrence.startsAt) - CHECK_IN_LEAD_MS;
    const closesAt = Date.parse(occurrence.endsAt) + CHECK_IN_GRACE_MS;
    if (nowMs < opensAt || nowMs > closesAt) throw new CheckInClosedError();

    const booking = await this.bookings.findByMemberOccurrence(memberId, occurrenceId);
    if (!booking || booking.status === 'cancelled') throw new NotBookedError();

    // Idempotent: a second tap (or a refresh) returns the existing row rather than double-recording.
    const existing = await this.attendance.findByMemberOccurrence(memberId, occurrenceId);
    if (existing) return existing;

    // Derive the discipline from the program so the check-in counts toward the right rank ladder.
    const program = await this.programs.findById(occurrence.programId);
    return this.attendance.record({
      memberId,
      occurrenceId,
      programId: occurrence.programId,
      disciplineId: program?.disciplineId ?? null,
      locationId: occurrence.locationId,
      occurredAt: new Date(nowMs).toISOString(),
      method: 'self',
    });
  }
}
