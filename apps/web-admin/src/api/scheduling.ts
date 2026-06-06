import { api } from '@obikai/api-client';
import type {
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
