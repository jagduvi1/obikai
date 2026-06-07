import type { AuthzActor } from '@obikai/authz';
import type {
  GradingResultRecord,
  Member,
  MemberRankState,
  ProgressionSystemVersion,
  Promotion,
} from '@obikai/domain';
import { mintVersion, validateConfig } from '@obikai/rank-engine';
import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  PromotionRefusedError,
  PromotionsService,
  type PromotionsStores,
} from './promotions.service.js';

/** A real, engine-minted white→blue system whose only criterion is 100 classes (required). */
function makeVersion(): ProgressionSystemVersion {
  const res = validateConfig({
    disciplineId: 'disc1',
    systemId: 'sys1',
    presentation: 'belt',
    tracks: [{ id: 'adult' }],
    ladder: [
      {
        id: 'white',
        kind: 'rank',
        order: 0,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'allOf', criteria: [] },
      },
      {
        id: 'blue',
        kind: 'rank',
        order: 10,
        trackId: 'adult',
        visual: {},
        criteria: { type: 'minClassesSinceLastPromotion', enforcement: 'required', count: 100 },
      },
    ],
    transitions: [],
    curricula: [],
  });
  if (!res.valid) throw new Error(`invalid fixture: ${JSON.stringify(res.errors)}`);
  return mintVersion(null, res.draft);
}

const VERSION = makeVersion();

class FakeRankStates {
  state: MemberRankState = {
    id: 'rs1' as MemberRankState['id'],
    tenantId: 't1' as MemberRankState['tenantId'],
    memberId: 'm1' as MemberRankState['memberId'],
    disciplineId: 'disc1' as MemberRankState['disciplineId'],
    systemId: 'sys1' as MemberRankState['systemId'],
    trackId: 'adult' as MemberRankState['trackId'],
    currentStepId: 'white' as MemberRankState['currentStepId'],
    enteredCurrentStepAt: '2026-01-01T00:00:00.000Z',
    archived: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  async findByMemberDiscipline(memberId: string, disciplineId: string) {
    return memberId === this.state.memberId && disciplineId === this.state.disciplineId
      ? this.state
      : null;
  }
  async update(
    _id: string,
    patch: { currentStepId?: string | null; enteredCurrentStepAt?: string },
  ) {
    this.state = { ...this.state, ...patch } as MemberRankState;
    return this.state;
  }
}

class FakePromotions {
  readonly rows: Promotion[] = [];
  async create(input: Parameters<PromotionsStores['promotions']['create']>[0]): Promise<Promotion> {
    const p = {
      id: `p${this.rows.length + 1}`,
      tenantId: 't1',
      createdAt: input.awardedAt,
      overrideReason: input.overrideReason ?? null,
      ...input,
    } as unknown as Promotion;
    this.rows.push(p);
    return p;
  }
  async list(opts: { memberId?: string; disciplineId?: string } = {}) {
    return this.rows
      .filter((r) => (opts.memberId ? r.memberId === opts.memberId : true))
      .filter((r) => (opts.disciplineId ? r.disciplineId === opts.disciplineId : true))
      .slice()
      .reverse();
  }
}

const stores = (
  attendanceCount = 0,
): { s: PromotionsStores; rankStates: FakeRankStates; promotions: FakePromotions } => {
  const rankStates = new FakeRankStates();
  const promotions = new FakePromotions();
  const s: PromotionsStores = {
    rankStates,
    promotions,
    versions: {
      async getCurrentVersion(systemId) {
        return systemId === 'sys1' ? VERSION : null;
      },
    },
    // Same count for both the since-last-promotion and total queries (sufficient for these cases).
    attendance: {
      async classesSinceLastPromotion() {
        return attendanceCount;
      },
    },
    grading: {
      async listByMember(): Promise<GradingResultRecord[]> {
        return [];
      },
    },
    completions: {
      async listByMemberDiscipline() {
        return [] as { itemKey: string }[];
      },
    },
    members: {
      async findById(): Promise<Member | null> {
        return null;
      },
    },
  };
  return { s, rankStates, promotions };
};

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const instructor = actor({ roles: [{ role: 'instructor', locationScope: 'ALL' }] });
const selfMember = actor({ memberId: 'm1', roles: [{ role: 'member', locationScope: 'ALL' }] });
const otherMember = actor({ memberId: 'm2', roles: [{ role: 'member', locationScope: 'ALL' }] });
const CLOCK = () => new Date('2026-12-01T00:00:00.000Z');

describe('PromotionsService.eligibility', () => {
  it('reports notYet with per-criterion progress when classes are short', async () => {
    const { s } = stores(40);
    const svc = new PromotionsService(s, CLOCK);
    const res = await svc.eligibility(owner, 'm1', 'disc1');
    expect(res.nextSteps).toHaveLength(1);
    expect(res.nextSteps[0]?.stepId).toBe('blue');
    expect(res.nextSteps[0]?.status).toBe('notYet');
    const c = res.nextSteps[0]?.criteria.find((x) => x.type === 'minClassesSinceLastPromotion');
    expect(c?.progress).toMatchObject({ current: 40, target: 100 });
  });

  it('reports ready once the required criterion is met', async () => {
    const { s } = stores(120);
    const svc = new PromotionsService(s, CLOCK);
    const res = await svc.eligibility(owner, 'm1', 'disc1');
    expect(res.nextSteps[0]?.status).toBe('ready');
  });

  it('lets a member read their OWN eligibility but not another member’s', async () => {
    const { s } = stores(10);
    const svc = new PromotionsService(s, CLOCK);
    await expect(svc.eligibility(selfMember, 'm1', 'disc1')).resolves.toBeTruthy();
    await expect(svc.eligibility(otherMember, 'm1', 'disc1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('throws NotFound when the member has no rank state in the discipline', async () => {
    const { s } = stores();
    const svc = new PromotionsService(s, CLOCK);
    await expect(svc.eligibility(owner, 'mX', 'disc1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('PromotionsService.award', () => {
  it('awards when criteria are met, persists an immutable promotion, and advances the rank state', async () => {
    const { s, rankStates, promotions } = stores(120);
    const svc = new PromotionsService(s, CLOCK);
    const promo = await svc.award(instructor, {
      memberId: 'm1',
      disciplineId: 'disc1',
      toStepId: 'blue',
    });
    expect(promo.toStepId).toBe('blue');
    expect(promo.fromStepId).toBe('white');
    expect(promo.awardedByRole).toBe('instructor');
    expect(promo.overrideReason).toBeNull();
    expect(promotions.rows).toHaveLength(1);
    // Rank state advanced to the awarded step.
    expect(rankStates.state.currentStepId).toBe('blue');
  });

  it('refuses when a required criterion is unmet and no override is given', async () => {
    const { s, promotions } = stores(10);
    const svc = new PromotionsService(s, CLOCK);
    await expect(
      svc.award(instructor, { memberId: 'm1', disciplineId: 'disc1', toStepId: 'blue' }),
    ).rejects.toBeInstanceOf(PromotionRefusedError);
    expect(promotions.rows).toHaveLength(0); // nothing persisted
  });

  it('allows a force-promote with an explicit overrideReason, recording it', async () => {
    const { s } = stores(10);
    const svc = new PromotionsService(s, CLOCK);
    const promo = await svc.award(owner, {
      memberId: 'm1',
      disciplineId: 'disc1',
      toStepId: 'blue',
      overrideReason: 'tournament gold; instructor discretion',
    });
    expect(promo.overrideReason).toContain('discretion');
    expect(promo.awardedByRole).toBe('owner');
  });

  it('denies a member from awarding', async () => {
    const { s } = stores(120);
    const svc = new PromotionsService(s, CLOCK);
    await expect(
      svc.award(selfMember, { memberId: 'm1', disciplineId: 'disc1', toStepId: 'blue' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws (not silently) if the rank-state advance no-ops, so history/position cannot diverge', async () => {
    const { s, rankStates } = stores(120);
    rankStates.update = async () => null; // simulate an archived/missing state losing the advance
    const svc = new PromotionsService(s, CLOCK);
    await expect(
      svc.award(instructor, { memberId: 'm1', disciplineId: 'disc1', toStepId: 'blue' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('PromotionsService.history', () => {
  it('returns a member’s promotions; a member may read their own, not others’', async () => {
    const { s } = stores(120);
    const svc = new PromotionsService(s, CLOCK);
    await svc.award(owner, { memberId: 'm1', disciplineId: 'disc1', toStepId: 'blue' });
    expect(await svc.history(owner, 'm1')).toHaveLength(1);
    expect(await svc.history(selfMember, 'm1')).toHaveLength(1);
    await expect(svc.history(otherMember, 'm1')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
