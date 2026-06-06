import { api } from '@obikai/api-client';
import type {
  Booking,
  ClassOccurrence,
  ClassSchedule,
  ClassScheduleCreateInput,
  Program,
  ProgramCreateInput,
} from '@obikai/domain';

/**
 * Scheduling API bindings (ADR-0014). Programs group classes; a ClassSchedule is a recurring rule
 * (iCal RRULE + start time/duration/capacity) pinned to a program + location; materialize expands a
 * schedule's RRULE over a horizon into concrete ClassOccurrences. Reusing the `@obikai/domain` types
 * keeps the admin in lockstep with exactly what the api returns.
 */

// ── Programs ──────────────────────────────────────────────────────────────────
export function listPrograms(opts: { active?: boolean } = {}): Promise<Program[]> {
  const qs = opts.active === undefined ? '' : `?active=${opts.active}`;
  return api.get<Program[]>(`/programs${qs}`);
}
export function createProgram(input: ProgramCreateInput): Promise<Program> {
  return api.post<Program>('/programs', input);
}

// ── Schedules ─────────────────────────────────────────────────────────────────
export function listSchedules(
  opts: { programId?: string; locationId?: string } = {},
): Promise<ClassSchedule[]> {
  const params = new URLSearchParams();
  if (opts.programId) params.set('programId', opts.programId);
  if (opts.locationId) params.set('locationId', opts.locationId);
  const qs = params.toString();
  return api.get<ClassSchedule[]>(`/schedules${qs ? `?${qs}` : ''}`);
}
export function createSchedule(input: ClassScheduleCreateInput): Promise<ClassSchedule> {
  return api.post<ClassSchedule>('/schedules', input);
}

/** Expand a schedule's RRULE over [from, to] into ClassOccurrences (idempotent). */
export function materializeSchedule(
  scheduleId: string,
  range: { from?: string; to: string },
): Promise<ClassOccurrence[]> {
  return api.post<ClassOccurrence[]>(
    `/schedules/${encodeURIComponent(scheduleId)}/materialize`,
    range,
  );
}

// ── Occurrences ───────────────────────────────────────────────────────────────
export function listOccurrences(
  opts: { from?: string; to?: string; locationId?: string; scheduleId?: string } = {},
): Promise<ClassOccurrence[]> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.locationId) params.set('locationId', opts.locationId);
  if (opts.scheduleId) params.set('scheduleId', opts.scheduleId);
  const qs = params.toString();
  return api.get<ClassOccurrence[]>(`/occurrences${qs ? `?${qs}` : ''}`);
}

export function getOccurrence(id: string): Promise<ClassOccurrence> {
  return api.get<ClassOccurrence>(`/occurrences/${encodeURIComponent(id)}`);
}

/** The roster (bookings) for one occurrence. */
export function listOccurrenceBookings(id: string): Promise<Booking[]> {
  return api.get<Booking[]>(`/occurrences/${encodeURIComponent(id)}/bookings`);
}

/** Cancel a single occurrence (a per-occurrence override; the recurring schedule is untouched). */
export function cancelOccurrence(id: string): Promise<ClassOccurrence> {
  return api.post<ClassOccurrence>(`/occurrences/${encodeURIComponent(id)}/cancel`);
}

// ── Bookings ──────────────────────────────────────────────────────────────────
export function createBooking(input: { occurrenceId: string; memberId: string }): Promise<Booking> {
  return api.post<Booking>('/bookings', input);
}

/** Cancel a booking; the api promotes the oldest waitlisted booking if one frees up. */
export function cancelBooking(id: string): Promise<void> {
  return api.del<void>(`/bookings/${encodeURIComponent(id)}`);
}
