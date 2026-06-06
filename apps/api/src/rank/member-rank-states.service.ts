import { type AuthzActor, can } from '@obikai/authz';
import type { MemberRankState, ProgressionSystem, ProgressionSystemVersion } from '@obikai/domain';

/**
 * MemberRankStatesService — enrolls a member into a discipline's progression (ADR-0015): the entry
 * point of the rank journey. Enrolling creates the member's MemberRankState at the pre-first-step
 * position (currentStepId: null, e.g. "white belt / ungraded") on the discipline's CURRENT system
 * version's first track; from there PromotionsService advances them. Enrolling is rank-lifecycle
 * admin, gated on `promotion` create (instructor/owner). Reads are self-accessible (a member sees
 * their own positions). Idempotent: re-enrolling returns the existing state.
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

export class RankEnrollmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RankEnrollmentError';
  }
}

export interface RankStateStore {
  findByMemberDiscipline(memberId: string, disciplineId: string): Promise<MemberRankState | null>;
  create(input: {
    memberId: string;
    disciplineId: string;
    systemId: string;
    trackId: string;
    currentStepId?: string | null;
    enteredCurrentStepAt: string;
  }): Promise<MemberRankState>;
  list(opts?: { memberId?: string; disciplineId?: string }): Promise<MemberRankState[]>;
}

export interface RankSystemReadStore {
  findSystemByDiscipline(disciplineId: string): Promise<ProgressionSystem | null>;
  getCurrentVersion(systemId: string): Promise<ProgressionSystemVersion | null>;
}

export class MemberRankStatesService {
  constructor(
    private readonly rankStates: RankStateStore,
    private readonly systems: RankSystemReadStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Enroll a member into a discipline's progression at the entry step. Idempotent. */
  async enroll(
    actor: AuthzActor,
    input: { memberId: string; disciplineId: string },
  ): Promise<MemberRankState> {
    if (!can(actor, { resource: 'promotion', action: 'create' }))
      throw new ForbiddenError('create', 'promotion');

    const existing = await this.rankStates.findByMemberDiscipline(
      input.memberId,
      input.disciplineId,
    );
    if (existing) return existing;

    const system = await this.systems.findSystemByDiscipline(input.disciplineId);
    if (!system) throw new NotFoundError('rankSystem', input.disciplineId);
    const version = await this.systems.getCurrentVersion(system.id);
    if (!version) throw new NotFoundError('rankSystemVersion', system.id);
    const firstTrack = version.tracks[0];
    if (!firstTrack) {
      throw new RankEnrollmentError(
        `discipline ${input.disciplineId} has no tracks to enroll into`,
      );
    }

    return this.rankStates.create({
      memberId: input.memberId,
      disciplineId: input.disciplineId,
      systemId: system.id,
      trackId: firstTrack.id,
      currentStepId: null,
      enteredCurrentStepAt: this.now().toISOString(),
    });
  }

  /** A member's rank positions across disciplines; members may read their OWN (self-access). */
  async list(actor: AuthzActor, memberId: string): Promise<MemberRankState[]> {
    if (!can(actor, { resource: 'promotion', action: 'list', ownerMemberId: memberId }))
      throw new ForbiddenError('list', 'promotion');
    return this.rankStates.list({ memberId });
  }

  async get(actor: AuthzActor, memberId: string, disciplineId: string): Promise<MemberRankState> {
    if (!can(actor, { resource: 'promotion', action: 'read', ownerMemberId: memberId }))
      throw new ForbiddenError('read', 'promotion');
    const state = await this.rankStates.findByMemberDiscipline(memberId, disciplineId);
    if (!state) throw new NotFoundError('rankState', `${memberId}/${disciplineId}`);
    return state;
  }
}
