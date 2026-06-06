import type { AuthzActor } from '@obikai/authz';
import type { Household, HouseholdCreateInput, Member } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  HouseholdsService,
  type HouseholdsStore,
  type MembersLinkStore,
  NotFoundError,
} from './households.service.js';

/** In-memory fake stores — let us unit-test RBAC + linking without Nest or Mongo. */
class FakeHouseholdStore implements HouseholdsStore {
  readonly byId = new Map<string, Household>();
  private seq = 0;
  constructor(private readonly members: FakeMemberStore) {}

  async create(input: HouseholdCreateInput): Promise<Household> {
    const id = `h${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const household: Household = {
      id: id as Household['id'],
      tenantId: 't1' as Household['tenantId'],
      name: input.name,
      payerMemberId: (input.payerMemberId ?? null) as Household['payerMemberId'],
      payerUserId: (input.payerUserId ?? null) as Household['payerUserId'],
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, household);
    return household;
  }
  async findById(id: string): Promise<Household | null> {
    return this.byId.get(id) ?? null;
  }
  async list(): Promise<Household[]> {
    return [...this.byId.values()];
  }
  async listMembers(householdId: string): Promise<Member[]> {
    return [...this.members.byId.values()].filter((m) => m.householdId === householdId);
  }
}

class FakeMemberStore implements MembersLinkStore {
  readonly byId = new Map<string, Member>();
  private seq = 0;

  seed(over: Partial<Member> = {}): Member {
    const id = `m${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const member: Member = {
      id: id as Member['id'],
      tenantId: 't1' as Member['tenantId'],
      userId: null,
      householdId: null,
      firstName: 'Aiko',
      lastName: 'Tanaka',
      email: null,
      phone: null,
      dateOfBirth: null,
      status: 'active',
      joinDate: null,
      emergencyContact: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
      ...over,
    };
    this.byId.set(member.id, member);
    return member;
  }
  async findById(id: string): Promise<Member | null> {
    return this.byId.get(id) ?? null;
  }
  async update(id: string, patch: { householdId?: string | null }): Promise<Member | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Member;
    this.byId.set(id, next);
    return next;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

const sample: HouseholdCreateInput = { name: 'Tanaka Family' };

describe('HouseholdsService RBAC', () => {
  let svc: HouseholdsService;
  let households: FakeHouseholdStore;
  let members: FakeMemberStore;
  beforeEach(() => {
    members = new FakeMemberStore();
    households = new FakeHouseholdStore(members);
    svc = new HouseholdsService(households, members);
  });

  it('lets staff create, list and read households', async () => {
    const created = await svc.create(staff, sample);
    expect(created.name).toBe('Tanaka Family');
    const list = await svc.list(staff);
    expect(list).toHaveLength(1);
    const got = await svc.get(staff, created.id);
    expect(got.id).toBe(created.id);
  });

  it('forbids a bare member from creating, listing or reading households', async () => {
    await expect(svc.create(member, sample)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.list(member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.get(member, 'h1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s on a missing household', async () => {
    await expect(svc.get(staff, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('HouseholdsService member linking', () => {
  let svc: HouseholdsService;
  let households: FakeHouseholdStore;
  let members: FakeMemberStore;
  beforeEach(() => {
    members = new FakeMemberStore();
    households = new FakeHouseholdStore(members);
    svc = new HouseholdsService(households, members);
  });

  it('links a member to a household by setting householdId', async () => {
    const h = await svc.create(staff, sample);
    const m = members.seed();
    const linked = await svc.linkMember(staff, h.id, m.id);
    expect(linked.householdId).toBe(h.id);
    const roster = await households.listMembers(h.id);
    expect(roster.map((r) => r.id)).toEqual([m.id]);
  });

  it('unlinks a member, clearing householdId', async () => {
    const h = await svc.create(staff, sample);
    const m = members.seed({ householdId: 'h1' as Member['householdId'] });
    await svc.unlinkMember(staff, h.id, m.id);
    const after = await members.findById(m.id);
    expect(after?.householdId).toBeNull();
  });

  it('forbids a bare member from linking or unlinking', async () => {
    const h = await svc.create(staff, sample);
    const m = members.seed();
    await expect(svc.linkMember(member, h.id, m.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.unlinkMember(member, h.id, m.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s linking into a missing household or a missing member', async () => {
    const h = await svc.create(staff, sample);
    const m = members.seed();
    await expect(svc.linkMember(staff, 'nope', m.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.linkMember(staff, h.id, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s unlinking a member not in the given household', async () => {
    const h = await svc.create(staff, sample);
    const m = members.seed({ householdId: 'other' as Member['householdId'] });
    await expect(svc.unlinkMember(staff, h.id, m.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
