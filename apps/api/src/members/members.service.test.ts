import type { AuthzActor } from '@obikai/authz';
import type { AuditAppendInput } from '@obikai/db';
import type { Member, MemberCreateInput, MemberStatus, MemberUpdateInput } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AuditPort,
  ForbiddenError,
  MembersService,
  type MembersStore,
  NotFoundError,
} from './members.service.js';

/** In-memory fake store — lets us unit-test RBAC + service logic without Nest or Mongo. */
class FakeStore implements MembersStore {
  private readonly byId = new Map<string, Member>();
  private seq = 0;

  async create(input: MemberCreateInput): Promise<Member> {
    const id = `m${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const member: Member = {
      id: id as Member['id'],
      tenantId: 't1' as Member['tenantId'],
      userId: null,
      householdId: (input.householdId ?? null) as Member['householdId'],
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      status: input.status,
      joinDate: input.joinDate ?? null,
      emergencyContact: input.emergencyContact ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, member);
    return member;
  }
  async findById(id: string): Promise<Member | null> {
    return this.byId.get(id) ?? null;
  }
  async list(opts: { status?: MemberStatus } = {}): Promise<Member[]> {
    const all = [...this.byId.values()];
    return opts.status ? all.filter((m) => m.status === opts.status) : all;
  }
  async update(id: string, patch: MemberUpdateInput): Promise<Member | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Member;
    this.byId.set(id, next);
    return next;
  }
  async remove(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

/** Records every audit append so tests can assert mutations are written to the tenant's chain. */
class FakeAudit implements AuditPort {
  readonly entries: AuditAppendInput[] = [];
  async append(input: AuditAppendInput): Promise<unknown> {
    this.entries.push(input);
    return input;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

const sample: MemberCreateInput = { firstName: 'Aiko', lastName: 'Tanaka', status: 'active' };

describe('MembersService RBAC', () => {
  let svc: MembersService;
  let audit: FakeAudit;
  beforeEach(() => {
    audit = new FakeAudit();
    svc = new MembersService(new FakeStore(), audit);
  });

  it('lets staff create and list members', async () => {
    const created = await svc.create(staff, sample);
    expect(created.firstName).toBe('Aiko');
    const list = await svc.list(staff);
    expect(list).toHaveLength(1);
  });

  it('forbids a bare member from creating or listing members', async () => {
    await expect(svc.create(member, sample)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.list(member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a member read their OWN record but not others (self-access)', async () => {
    const created = await svc.create(staff, sample);
    const self = actor({
      userId: 'u2',
      memberId: created.id,
      roles: [{ role: 'member', locationScope: 'ALL' }],
    });
    const got = await svc.get(self, created.id);
    expect(got.id).toBe(created.id);

    const other = actor({
      userId: 'u3',
      memberId: 'someone-else',
      roles: [{ role: 'member', locationScope: 'ALL' }],
    });
    await expect(svc.get(other, created.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('404s on a missing member', async () => {
    await expect(svc.get(staff, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets staff update but a non-owner member cannot', async () => {
    const created = await svc.create(staff, sample);
    const updated = await svc.update(staff, created.id, { status: 'frozen' });
    expect(updated.status).toBe('frozen');
    await expect(svc.update(member, created.id, { status: 'active' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('audits every member mutation (create/update/delete) with actor, target, and ip (H9)', async () => {
    const created = await svc.create(staff, sample, { ip: '203.0.113.9' });
    await svc.update(staff, created.id, { status: 'frozen' }, { ip: '203.0.113.9' });
    await svc.remove(owner, created.id, { ip: '203.0.113.9' }); // delete is owner-only

    expect(audit.entries.map((e) => e.action)).toEqual([
      'member.create',
      'member.update',
      'member.delete',
    ]);
    for (const e of audit.entries) {
      expect(e).toMatchObject({
        actorId: 'u1',
        actorType: 'user',
        targetType: 'member',
        ip: '203.0.113.9',
      });
      expect(e.targetId).toBe(created.id);
    }
    // The update diff records changed FIELD NAMES only — never personal-data values (PII-minimized).
    expect(audit.entries[1]?.diff).toEqual({ fields: ['status'] });
  });

  it('does NOT audit reads (list/get)', async () => {
    const created = await svc.create(staff, sample);
    audit.entries.length = 0; // ignore the create above
    await svc.list(staff);
    await svc.get(staff, created.id);
    expect(audit.entries).toHaveLength(0);
  });

  it('does not record a delete that did not happen (missing member throws before audit)', async () => {
    await expect(svc.remove(owner, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(audit.entries).toHaveLength(0);
  });
});
