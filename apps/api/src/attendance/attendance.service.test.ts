import type { AuthzActor } from '@obikai/authz';
import type { Attendance, AttendanceCreateInput } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AttendanceFilter,
  AttendanceService,
  type AttendanceStore,
  ForbiddenError,
} from './attendance.service.js';

/** In-memory fake store — lets us unit-test RBAC + service logic without Nest or Mongo. */
class FakeStore implements AttendanceStore {
  private readonly rows: Attendance[] = [];
  private seq = 0;

  async record(input: AttendanceCreateInput): Promise<Attendance> {
    const id = `a${++this.seq}`;
    const occurredAt = input.occurredAt ?? '2026-06-06T00:00:00.000Z';
    const row: Attendance = {
      id: id as Attendance['id'],
      tenantId: 't1' as Attendance['tenantId'],
      memberId: input.memberId as Attendance['memberId'],
      occurrenceId: (input.occurrenceId ?? null) as Attendance['occurrenceId'],
      programId: (input.programId ?? null) as Attendance['programId'],
      disciplineId: input.disciplineId ?? null,
      locationId: (input.locationId ?? null) as Attendance['locationId'],
      occurredAt,
      method: input.method,
      createdAt: '2026-06-06T00:00:00.000Z',
    };
    this.rows.push(row);
    return row;
  }
  async list(filter: AttendanceFilter = {}): Promise<Attendance[]> {
    return this.rows.filter(
      (r) =>
        (filter.memberId === undefined || r.memberId === filter.memberId) &&
        (filter.disciplineId === undefined || r.disciplineId === filter.disciplineId),
    );
  }
  async classesSinceLastPromotion(
    memberId: string,
    disciplineId: string,
    since: Date,
  ): Promise<number> {
    return this.rows.filter(
      (r) =>
        r.memberId === memberId &&
        r.disciplineId === disciplineId &&
        new Date(r.occurredAt) > since,
    ).length;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const instructor = actor({ roles: [{ role: 'instructor', locationScope: 'ALL' }] });
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });
const bare = actor({ roles: [] });

const sample: AttendanceCreateInput = { memberId: 'm1', disciplineId: 'bjj', method: 'instructor' };

describe('AttendanceService RBAC', () => {
  let svc: AttendanceService;
  beforeEach(() => {
    svc = new AttendanceService(new FakeStore());
  });

  it('lets an instructor record and list attendance', async () => {
    const created = await svc.record(instructor, sample);
    expect(created.memberId).toBe('m1');
    const list = await svc.list(instructor, { memberId: 'm1' });
    expect(list).toHaveLength(1);
  });

  it('lets front-desk staff record attendance', async () => {
    const created = await svc.record(staff, sample);
    expect(created.disciplineId).toBe('bjj');
  });

  it('forbids a bare actor (no roles) from recording or listing', async () => {
    await expect(svc.record(bare, sample)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.list(bare, { memberId: 'm1' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forbids a member from recording (no create grant)', async () => {
    await expect(svc.record(member, sample)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets a member list their OWN attendance via self-access', async () => {
    await svc.record(staff, sample);
    const self = actor({
      userId: 'u2',
      memberId: 'm1',
      roles: [{ role: 'member', locationScope: 'ALL' }],
    });
    const list = await svc.list(self, { memberId: 'm1' });
    expect(list).toHaveLength(1);
  });

  it("forbids a bare actor from listing another member's attendance", async () => {
    await svc.record(staff, sample);
    const other = actor({ userId: 'u3', memberId: 'someone-else', roles: [] });
    await expect(svc.list(other, { memberId: 'm1' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets staff query classesSinceLastPromotion and counts correctly', async () => {
    await svc.record(staff, {
      memberId: 'm1',
      disciplineId: 'bjj',
      occurredAt: '2026-03-05T18:00:00.000Z',
      method: 'instructor',
    });
    await svc.record(staff, {
      memberId: 'm1',
      disciplineId: 'bjj',
      occurredAt: '2026-02-01T18:00:00.000Z',
      method: 'instructor',
    });
    const count = await svc.classesSinceLastPromotion(
      staff,
      'm1',
      'bjj',
      new Date('2026-03-01T00:00:00.000Z'),
    );
    expect(count).toBe(1);
  });

  it('lets a member query their OWN classesSinceLastPromotion via self-access', async () => {
    await svc.record(staff, {
      memberId: 'm1',
      disciplineId: 'bjj',
      occurredAt: '2026-03-05T18:00:00.000Z',
      method: 'instructor',
    });
    const self = actor({
      userId: 'u2',
      memberId: 'm1',
      roles: [{ role: 'member', locationScope: 'ALL' }],
    });
    const count = await svc.classesSinceLastPromotion(
      self,
      'm1',
      'bjj',
      new Date('2026-03-01T00:00:00.000Z'),
    );
    expect(count).toBe(1);
  });

  it("forbids a bare actor from querying another member's classesSinceLastPromotion", async () => {
    const other = actor({ userId: 'u3', memberId: 'someone-else', roles: [] });
    await expect(
      svc.classesSinceLastPromotion(other, 'm1', 'bjj', new Date('2026-03-01T00:00:00.000Z')),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
