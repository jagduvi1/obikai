import { type AuthzActor, can } from '@obikai/authz';
import type {
  CriterionEvaluation,
  CriterionLeafType,
  EligibilityResult,
  GradingResultRecord,
  Instant,
  Member,
  MemberRankState,
  ProgressionSystemVersion,
  Promotion,
} from '@obikai/domain';
import { type AwardRequest, evaluateEligibility, promote } from '@obikai/rank-engine';

/**
 * PromotionsService — the human-in-the-loop heart of the rank journey (ADR-0005/0015). It assembles
 * a student's snapshot from persisted facts (rank state, attendance-since-last-promotion, grading
 * results, curriculum completions, date of birth), runs the PURE engine to compute eligibility, and
 * on an explicit instructor/owner award records an IMMUTABLE promotion + advances the member's rank
 * state. The engine never auto-promotes and AI is never on this path (invariants 4/5). Awarding is
 * itself the instructor sign-off; a force-promote past an unmet required criterion needs an explicit
 * human `overrideReason`.
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** Raised when the engine refuses an award (unmet required criteria with no override / unknown step). */
export class PromotionRefusedError extends Error {
  constructor(
    readonly reason: 'requiredCriteriaUnmet' | 'unknownStep',
    readonly unmet: readonly CriterionLeafType[],
  ) {
    super(`promotion refused: ${reason}`);
    this.name = 'PromotionRefusedError';
  }
}

// ── Narrow persistence surfaces (satisfied by @obikai/db repositories) ───────────
export interface RankStateStore {
  findByMemberDiscipline(memberId: string, disciplineId: string): Promise<MemberRankState | null>;
  update(
    id: string,
    patch: { currentStepId?: string | null; trackId?: string; enteredCurrentStepAt?: string },
  ): Promise<MemberRankState | null>;
}
export interface VersionStore {
  getCurrentVersion(systemId: string): Promise<ProgressionSystemVersion | null>;
}
export interface PromotionStore {
  create(input: {
    memberId: string;
    disciplineId: string;
    systemId: string;
    systemVersionId: string;
    fromStepId: string | null;
    toStepId: string;
    awardedAt: string;
    awardedByRole: 'instructor' | 'owner';
    awardingUserId: string;
    satisfiedSnapshot: readonly CriterionEvaluation[];
    overrideReason?: string | null;
  }): Promise<Promotion>;
  list(opts?: { memberId?: string; disciplineId?: string }): Promise<Promotion[]>;
}
export interface AttendanceCountStore {
  classesSinceLastPromotion(memberId: string, disciplineId: string, since: Date): Promise<number>;
}
export interface GradingReadStore {
  listByMember(memberId: string): Promise<GradingResultRecord[]>;
}
export interface CompletionReadStore {
  listByMemberDiscipline(memberId: string, disciplineId: string): Promise<{ itemKey: string }[]>;
}
export interface MemberReadStore {
  findById(id: string): Promise<Member | null>;
}

export interface PromotionsStores {
  rankStates: RankStateStore;
  versions: VersionStore;
  promotions: PromotionStore;
  attendance: AttendanceCountStore;
  grading: GradingReadStore;
  completions: CompletionReadStore;
  members: MemberReadStore;
}

export interface AwardInput {
  memberId: string;
  disciplineId: string;
  toStepId: string;
  overrideReason?: string;
}

const toInstant = (iso: string): Instant => ({ epochMs: Date.parse(iso) });
const fromInstant = (i: Instant): string => new Date(i.epochMs).toISOString();
const actorIsOwner = (actor: AuthzActor): boolean => actor.roles.some((r) => r.role === 'owner');

export class PromotionsService {
  constructor(
    private readonly stores: PromotionsStores,
    /** Injectable clock for deterministic eligibility/award timestamps. */
    private readonly now: () => Date = () => new Date(),
    /** Pinned tenant IANA timezone for the engine's calendar/age math (ADR-0005). */
    private readonly zone = 'Europe/Stockholm',
  ) {}

  /**
   * Assemble the engine input for a member in a discipline. Returns null if the member has no rank
   * state in the discipline or the system has no current version.
   */
  private async buildSnapshot(
    memberId: string,
    disciplineId: string,
  ): Promise<{ state: MemberRankState; version: ProgressionSystemVersion } | null> {
    const state = await this.stores.rankStates.findByMemberDiscipline(memberId, disciplineId);
    if (!state) return null;
    const version = await this.stores.versions.getCurrentVersion(state.systemId);
    if (!version) return null;
    return { state, version };
  }

  private async buildInput(state: MemberRankState, version: ProgressionSystemVersion) {
    const { memberId, disciplineId } = state;
    // "Classes since last promotion": after the last promotion's awardedAt, else since step entry.
    const history = await this.stores.promotions.list({ memberId, disciplineId });
    const sinceIso = history[0]?.awardedAt ?? state.enteredCurrentStepAt;
    const [attendanceSinceLastPromotion, totalAttendance] = await Promise.all([
      this.stores.attendance.classesSinceLastPromotion(memberId, disciplineId, new Date(sinceIso)),
      this.stores.attendance.classesSinceLastPromotion(memberId, disciplineId, new Date(0)),
    ]);
    const grading = await this.stores.grading.listByMember(memberId);
    const completions = await this.stores.completions.listByMemberDiscipline(
      memberId,
      disciplineId,
    );
    const member = await this.stores.members.findById(memberId);

    return {
      systemVersionId: version.versionId,
      trackId: state.trackId,
      currentStepId: state.currentStepId,
      enteredCurrentStepAt: toInstant(state.enteredCurrentStepAt),
      ...(member?.dateOfBirth ? { dateOfBirth: toInstant(member.dateOfBirth) } : {}),
      attendanceSinceLastPromotion,
      totalAttendance,
      completedCurriculumItemIds: completions.map((c) => c.itemKey),
      gradingResults: grading.map((g: GradingResultRecord) => ({
        stepId: g.stepId,
        passed: g.passed,
        at: toInstant(g.recordedAt),
      })),
      manualSignOffs: [],
    };
  }

  /** The eligibility dashboard for a member in a discipline (ready/close/notYet + "how close"). */
  async eligibility(
    actor: AuthzActor,
    memberId: string,
    disciplineId: string,
  ): Promise<EligibilityResult> {
    if (!can(actor, { resource: 'promotion', action: 'read', ownerMemberId: memberId }))
      throw new ForbiddenError('read', 'promotion');
    const snap = await this.buildSnapshot(memberId, disciplineId);
    if (!snap) throw new NotFoundError('rankState', `${memberId}/${disciplineId}`);
    const input = await this.buildInput(snap.state, snap.version);
    return evaluateEligibility(snap.version, input, {
      now: { epochMs: this.now().getTime() },
      zone: this.zone,
    });
  }

  /**
   * Award a promotion (instructor/owner only). The awarding actor is recorded as the manual sign-off
   * for the target step; the engine refuses unmet required criteria unless an `overrideReason` is
   * given. On success the immutable promotion is persisted and the member's rank state advances.
   */
  async award(actor: AuthzActor, input: AwardInput): Promise<Promotion> {
    if (!can(actor, { resource: 'promotion', action: 'award' }))
      throw new ForbiddenError('award', 'promotion');
    const snap = await this.buildSnapshot(input.memberId, input.disciplineId);
    if (!snap) throw new NotFoundError('rankState', `${input.memberId}/${input.disciplineId}`);

    const byRole: 'instructor' | 'owner' = actorIsOwner(actor) ? 'owner' : 'instructor';
    const nowInstant: Instant = { epochMs: this.now().getTime() };
    const base = await this.buildInput(snap.state, snap.version);
    // Awarding IS the instructor sign-off for the target step.
    const engineInput = {
      ...base,
      manualSignOffs: [
        { stepId: input.toStepId as never, byRole, at: nowInstant, signerId: actor.userId },
      ],
    };
    const award: AwardRequest = {
      toStepId: input.toStepId as never,
      byRole,
      userId: actor.userId,
      ...(input.overrideReason !== undefined ? { overrideReason: input.overrideReason } : {}),
    };
    const outcome = promote(snap.version, engineInput, award, {
      now: nowInstant,
      zone: this.zone,
    });
    if (!outcome.ok) throw new PromotionRefusedError(outcome.reason, outcome.unmet);

    const entry = outcome.entry;
    const awardedAt = fromInstant(entry.awardedAt);
    const promotion = await this.stores.promotions.create({
      memberId: input.memberId,
      disciplineId: input.disciplineId,
      systemId: entry.systemId,
      systemVersionId: entry.systemVersionId,
      fromStepId: entry.fromStepId,
      toStepId: entry.toStepId,
      awardedAt,
      awardedByRole: entry.awardedByRole,
      awardingUserId: entry.awardingUserId,
      satisfiedSnapshot: entry.satisfiedSnapshot,
      overrideReason: entry.overrideReason ?? null,
    });
    // Advance the member's position to the awarded step (the only mutation of rank state).
    await this.stores.rankStates.update(snap.state.id, {
      currentStepId: entry.toStepId,
      enteredCurrentStepAt: awardedAt,
    });
    return promotion;
  }

  /** Immutable promotion history; members may read their own (self-access). */
  async history(actor: AuthzActor, memberId: string, disciplineId?: string): Promise<Promotion[]> {
    if (!can(actor, { resource: 'promotion', action: 'list', ownerMemberId: memberId }))
      throw new ForbiddenError('list', 'promotion');
    return this.stores.promotions.list({
      memberId,
      ...(disciplineId !== undefined ? { disciplineId } : {}),
    });
  }
}
