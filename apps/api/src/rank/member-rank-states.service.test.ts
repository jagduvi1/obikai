import type { AuthzActor } from '@obikai/authz';
import type { MemberRankState, ProgressionSystem, ProgressionSystemVersion } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  MemberRankStatesService,
  NotFoundError,
  type RankStateStore,
  type RankSystemReadStore,
} from './member-rank-states.service.js';

const VERSION = {
  systemId: 'sys1',
  versionId: 'v1',
  version: 1,
  disciplineId: 'disc1',
  presentation: 'belt',
  tracks: [{ id: 'adult' }, { id: 'kids' }],
  ladder: [],
  transitions: [],
  curricula: [],
  contentHash: 'h',
} as unknown as ProgressionSystemVersion;

class FakeRankStates implements RankStateStore {
  readonly rows: MemberRankState[] = [];
  private seq = 0;
  async findByMemberDiscipline(memberId: string, disciplineId: string) {
    return (
      this.rows.find((r) => r.memberId === memberId && r.disciplineId === disciplineId) ?? null
    );
  }
  async create(input: {
    memberId: string;
    disciplineId: string;
    systemId: string;
    trackId: string;
    currentStepId?: string | null;
    enteredCurrentStepAt: string;
  }): Promise<MemberRankState> {
    const rec = {
      id: `rs${++this.seq}`,
      tenantId: 't1',
      archived: false,
      createdAt: input.enteredCurrentStepAt,
      updatedAt: input.enteredCurrentStepAt,
      currentStepId: input.currentStepId ?? null,
      ...input,
    } as unknown as MemberRankState;
    this.rows.push(rec);
    return rec;
  }
  async list(opts: { memberId?: string; disciplineId?: string } = {}) {
    return this.rows.filter((r) => (opts.memberId ? r.memberId === opts.memberId : true));
  }
}

const systems = (hasSystem = true, hasVersion = true): RankSystemReadStore => ({
  async findSystemByDiscipline(disciplineId) {
    return hasSystem
      ? ({
          id: 'sys1',
          disciplineId,
          currentVersionId: 'v1',
          versionIds: ['v1'],
        } as ProgressionSystem)
      : null;
  },
  async getCurrentVersion() {
    return hasVersion ? VERSION : null;
  },
});

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const instructor = actor({ roles: [{ role: 'instructor', locationScope: 'ALL' }] });
const selfMember = actor({ memberId: 'm1', roles: [{ role: 'member', locationScope: 'ALL' }] });
const otherMember = actor({ memberId: 'm2', roles: [{ role: 'member', locationScope: 'ALL' }] });
const CLOCK = () => new Date('2026-06-06T00:00:00.000Z');

describe('MemberRankStatesService.enroll', () => {
  it('creates a rank state at the entry step on the first track', async () => {
    const rs = new FakeRankStates();
    const svc = new MemberRankStatesService(rs, systems(), CLOCK);
    const state = await svc.enroll(instructor, { memberId: 'm1', disciplineId: 'disc1' });
    expect(state.currentStepId).toBeNull();
    expect(state.trackId).toBe('adult'); // first track
    expect(state.systemId).toBe('sys1');
    expect(state.enteredCurrentStepAt).toBe('2026-06-06T00:00:00.000Z');
  });

  it('is idempotent — re-enrolling returns the existing state', async () => {
    const rs = new FakeRankStates();
    const svc = new MemberRankStatesService(rs, systems(), CLOCK);
    const a = await svc.enroll(instructor, { memberId: 'm1', disciplineId: 'disc1' });
    const b = await svc.enroll(instructor, { memberId: 'm1', disciplineId: 'disc1' });
    expect(b.id).toBe(a.id);
    expect(rs.rows).toHaveLength(1);
  });

  it('throws NotFound when the discipline has no rank system', async () => {
    const svc = new MemberRankStatesService(new FakeRankStates(), systems(false), CLOCK);
    await expect(
      svc.enroll(instructor, { memberId: 'm1', disciplineId: 'disc1' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a member from enrolling', async () => {
    const svc = new MemberRankStatesService(new FakeRankStates(), systems(), CLOCK);
    await expect(
      svc.enroll(selfMember, { memberId: 'm1', disciplineId: 'disc1' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('MemberRankStatesService.list', () => {
  it('lets a member read their own positions but not another member’s', async () => {
    const rs = new FakeRankStates();
    const svc = new MemberRankStatesService(rs, systems(), CLOCK);
    await svc.enroll(instructor, { memberId: 'm1', disciplineId: 'disc1' });
    expect(await svc.list(selfMember, 'm1')).toHaveLength(1);
    await expect(svc.list(otherMember, 'm1')).rejects.toBeInstanceOf(ForbiddenError);
  });
});
