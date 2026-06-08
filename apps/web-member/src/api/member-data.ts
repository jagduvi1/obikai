import { api } from '@obikai/api-client';
import type {
  Booking,
  ClassOccurrence,
  CurriculumCompletion,
  Discipline,
  EligibilityResult,
  Invoice,
  MemberRankState,
  MemberWaiverStatus,
  Program,
  Promotion,
  RoleAssignment,
  WaiverSignInput,
  WaiverSignature,
} from '@obikai/domain';

/** The arts the dojo offers (shared reference data; members may read). */
export function myDisciplines(): Promise<Discipline[]> {
  return api.get<Discipline[]>('/disciplines');
}

/** The current principal (GET /me) — the PWA learns its own memberId here after login. */
export interface Me {
  userId: string;
  memberId: string | null;
  roles: readonly RoleAssignment[];
}
export function getMe(): Promise<Me> {
  return api.get<Me>('/me');
}

/** The member's own data — all reachable via the api's self-access checks (ownerMemberId). */
export function myRankStates(memberId: string): Promise<MemberRankState[]> {
  return api.get<MemberRankState[]>(`/rank-states?memberId=${encodeURIComponent(memberId)}`);
}
export function myEligibility(memberId: string, disciplineId: string): Promise<EligibilityResult> {
  return api.get<EligibilityResult>(
    `/promotions/eligibility?memberId=${encodeURIComponent(memberId)}&disciplineId=${encodeURIComponent(disciplineId)}`,
  );
}
export function myPromotions(memberId: string, disciplineId?: string): Promise<Promotion[]> {
  const qs = disciplineId
    ? `?memberId=${encodeURIComponent(memberId)}&disciplineId=${encodeURIComponent(disciplineId)}`
    : `?memberId=${encodeURIComponent(memberId)}`;
  return api.get<Promotion[]>(`/promotions${qs}`);
}
export function myCurriculumCompletions(
  memberId: string,
  disciplineId: string,
): Promise<CurriculumCompletion[]> {
  return api.get<CurriculumCompletion[]>(
    `/curriculum/completions?memberId=${encodeURIComponent(memberId)}&disciplineId=${encodeURIComponent(disciplineId)}`,
  );
}
export function myInvoices(memberId: string): Promise<Invoice[]> {
  return api.get<Invoice[]>(`/invoices?memberId=${encodeURIComponent(memberId)}`);
}

/** Active waiver templates + whether the member has signed each one's current version (self-access). */
export function myWaiverStatus(memberId: string): Promise<MemberWaiverStatus[]> {
  return api.get<MemberWaiverStatus[]>(`/waivers/status?memberId=${encodeURIComponent(memberId)}`);
}

/** Record a digital acknowledgement — the member signs their own waiver (no uploaded document). */
export function signWaiver(input: WaiverSignInput): Promise<WaiverSignature> {
  return api.post<WaiverSignature>('/waivers/sign', input);
}

// ── Class schedule + booking (§4.3/§4.6) ─────────────────────────────────────

/** The dojo's class programs (names for the schedule); members may read tenant-wide (RBAC 'class'). */
export function listPrograms(): Promise<Program[]> {
  return api.get<Program[]>('/programs');
}

/** Upcoming class occurrences in a window (ISO datetimes). Members may read (RBAC 'class'). */
export function listOccurrences(from: string, to: string): Promise<ClassOccurrence[]> {
  const params = new URLSearchParams({ from, to });
  return api.get<ClassOccurrence[]>(`/occurrences?${params.toString()}`);
}

/** The member's own bookings ("my classes"), via self-access (GET /bookings?memberId=own). */
export function myBookings(memberId: string): Promise<Booking[]> {
  return api.get<Booking[]>(`/bookings?memberId=${encodeURIComponent(memberId)}`);
}

/** Book the member onto an occurrence (capacity → 'booked', else 'waitlisted'). */
export function bookOccurrence(occurrenceId: string, memberId: string): Promise<Booking> {
  return api.post<Booking>('/bookings', { occurrenceId, memberId });
}

/** Cancel a booking (frees a seat → promotes the oldest waitlisted). Resolves on 204. */
export function cancelBooking(bookingId: string): Promise<void> {
  return api.del<void>(`/bookings/${encodeURIComponent(bookingId)}`);
}
