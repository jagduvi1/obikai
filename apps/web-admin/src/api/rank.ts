import { api } from '@obikai/api-client';
import type {
  Discipline,
  DisciplineCreateInput,
  EligibilityResult,
  MemberRankState,
  Promotion,
} from '@obikai/domain';

/** Disciplines (arts the dojo teaches). */
export function listDisciplines(opts: { active?: boolean } = {}): Promise<Discipline[]> {
  const qs = opts.active === undefined ? '' : `?active=${opts.active}`;
  return api.get<Discipline[]>(`/disciplines${qs}`);
}
export function createDiscipline(input: DisciplineCreateInput): Promise<Discipline> {
  return api.post<Discipline>('/disciplines', input);
}

/** A member's rank positions + enrollment. */
export function listRankStates(memberId: string): Promise<MemberRankState[]> {
  return api.get<MemberRankState[]>(`/rank-states?memberId=${encodeURIComponent(memberId)}`);
}
export function enrollInDiscipline(
  memberId: string,
  disciplineId: string,
): Promise<MemberRankState> {
  return api.post<MemberRankState>('/rank-states', { memberId, disciplineId });
}

/** Eligibility dashboard for a member in a discipline (ready/close/notYet + per-criterion progress). */
export function getEligibility(memberId: string, disciplineId: string): Promise<EligibilityResult> {
  return api.get<EligibilityResult>(
    `/promotions/eligibility?memberId=${encodeURIComponent(memberId)}&disciplineId=${encodeURIComponent(disciplineId)}`,
  );
}

/** Immutable promotion history for a member (optionally one discipline). */
export function listPromotions(memberId: string, disciplineId?: string): Promise<Promotion[]> {
  const qs = disciplineId
    ? `?memberId=${encodeURIComponent(memberId)}&disciplineId=${encodeURIComponent(disciplineId)}`
    : `?memberId=${encodeURIComponent(memberId)}`;
  return api.get<Promotion[]>(`/promotions${qs}`);
}

export interface AwardInput {
  memberId: string;
  disciplineId: string;
  toStepId: string;
  overrideReason?: string;
}
/** Award a promotion (human-in-the-loop). Throws ApiError 422 { reason, unmet } if refused. */
export function awardPromotion(input: AwardInput): Promise<Promotion> {
  return api.post<Promotion>('/promotions', input);
}
