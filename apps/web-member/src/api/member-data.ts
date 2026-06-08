import { api } from '@obikai/api-client';
import type {
  CurriculumCompletion,
  Discipline,
  EligibilityResult,
  Invoice,
  MemberRankState,
  MemberWaiverStatus,
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
