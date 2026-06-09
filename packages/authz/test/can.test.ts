import type { RoleAssignment } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  type AuthzActor,
  DEFAULT_GUARDIAN_GRANTS,
  type GuardianshipGrant,
  can,
} from '../src/index.js';

const role = (
  r: RoleAssignment['role'],
  locationScope: RoleAssignment['locationScope'] = 'ALL',
): RoleAssignment => ({
  role: r,
  locationScope,
});

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});

describe('can() — role grants', () => {
  it('owner can do anything in the tenant', () => {
    const o = actor({ roles: [role('owner')] });
    expect(can(o, { resource: 'invoice', action: 'create' })).toBe(true);
    expect(can(o, { resource: 'promotion', action: 'award' })).toBe(true);
    expect(can(o, { resource: 'auditLog', action: 'erase' })).toBe(true);
  });

  it('instructor can award rank but not manage billing', () => {
    const i = actor({ roles: [role('instructor')] });
    expect(can(i, { resource: 'promotion', action: 'award' })).toBe(true);
    expect(can(i, { resource: 'invoice', action: 'create' })).toBe(false);
  });

  it('staff can manage members/billing but not award rank', () => {
    const s = actor({ roles: [role('staff')] });
    expect(can(s, { resource: 'member', action: 'create' })).toBe(true);
    expect(can(s, { resource: 'invoice', action: 'create' })).toBe(true);
    expect(can(s, { resource: 'promotion', action: 'award' })).toBe(false);
  });

  it('a bare member cannot list other members', () => {
    const m = actor({ roles: [role('member')] });
    expect(can(m, { resource: 'member', action: 'list' })).toBe(false);
    expect(can(m, { resource: 'class', action: 'list' })).toBe(true);
  });
});

describe('can() — location scoping', () => {
  it('a location-scoped instructor only acts within their location', () => {
    const i = actor({ roles: [role('instructor', ['loc-1'])] });
    expect(can(i, { resource: 'attendance', action: 'create', locationId: 'loc-1' })).toBe(true);
    expect(can(i, { resource: 'attendance', action: 'create', locationId: 'loc-2' })).toBe(false);
    // A location-scoped role cannot act on a tenant-wide (no-location) resource.
    expect(can(i, { resource: 'attendance', action: 'create' })).toBe(false);
  });
});

describe('can() — self-access', () => {
  it('a member may read/update their OWN record but not others', () => {
    const m = actor({ memberId: 'mem-1', roles: [role('member')] });
    expect(can(m, { resource: 'member', action: 'read', ownerMemberId: 'mem-1' })).toBe(true);
    expect(can(m, { resource: 'member', action: 'update', ownerMemberId: 'mem-1' })).toBe(true);
    expect(can(m, { resource: 'member', action: 'read', ownerMemberId: 'mem-2' })).toBe(false);
    expect(can(m, { resource: 'member', action: 'delete', ownerMemberId: 'mem-1' })).toBe(false);
  });
});

describe('can() — guardianship', () => {
  const guardianships: GuardianshipGrant[] = [
    {
      guardianUserId: 'u1',
      minorMemberId: 'kid-1',
      grants: [
        { resource: 'invoice', action: 'read' },
        { resource: 'waiver', action: 'create' },
      ],
    },
  ];

  it('a guardian may act on a linked minor per the granted permissions', () => {
    const g = actor({ userId: 'u1', roles: [role('guardian')] });
    expect(
      can(g, { resource: 'invoice', action: 'read', ownerMemberId: 'kid-1' }, { guardianships }),
    ).toBe(true);
    expect(
      can(g, { resource: 'waiver', action: 'create', ownerMemberId: 'kid-1' }, { guardianships }),
    ).toBe(true);
  });

  it('a guardian cannot act on an unlinked minor or beyond granted permissions', () => {
    const g = actor({ userId: 'u1', roles: [role('guardian')] });
    expect(
      can(g, { resource: 'invoice', action: 'read', ownerMemberId: 'kid-2' }, { guardianships }),
    ).toBe(false);
    expect(
      can(g, { resource: 'invoice', action: 'delete', ownerMemberId: 'kid-1' }, { guardianships }),
    ).toBe(false);
  });

  it('a revoked guardianship grants nothing', () => {
    const revoked: GuardianshipGrant[] = [{ ...guardianships[0]!, revokedAt: new Date() }];
    const g = actor({ userId: 'u1', roles: [role('guardian')] });
    expect(
      can(
        g,
        { resource: 'invoice', action: 'read', ownerMemberId: 'kid-1' },
        { guardianships: revoked },
      ),
    ).toBe(false);
  });

  it('honors guardianships carried ON THE ACTOR (how the tenancy middleware supplies them)', () => {
    // No opts.guardianships — the edges ride on the actor (loaded into the request context).
    const g = actor({ userId: 'u1', roles: [role('guardian')], guardianships });
    expect(can(g, { resource: 'invoice', action: 'read', ownerMemberId: 'kid-1' })).toBe(true);
    expect(can(g, { resource: 'invoice', action: 'read', ownerMemberId: 'kid-2' })).toBe(false);
    // A revokedAt as an ISO STRING (the persisted shape) is honored too.
    const revokedStr = actor({
      userId: 'u1',
      roles: [role('guardian')],
      guardianships: [{ ...guardianships[0]!, revokedAt: '2026-06-01T00:00:00.000Z' }],
    });
    expect(can(revokedStr, { resource: 'invoice', action: 'read', ownerMemberId: 'kid-1' })).toBe(
      false,
    );
  });

  it('DEFAULT_GUARDIAN_GRANTS let a parent manage their kid but not delete/list others', () => {
    const g = actor({
      userId: 'u1',
      roles: [role('guardian')],
      guardianships: [
        { guardianUserId: 'u1', minorMemberId: 'kid-1', grants: DEFAULT_GUARDIAN_GRANTS },
      ],
    });
    expect(can(g, { resource: 'member', action: 'update', ownerMemberId: 'kid-1' })).toBe(true);
    expect(can(g, { resource: 'attendance', action: 'list', ownerMemberId: 'kid-1' })).toBe(true);
    expect(can(g, { resource: 'waiver', action: 'create', ownerMemberId: 'kid-1' })).toBe(true);
    // Booking/cancelling the child's classes (the schedule actions) — class create/update on the edge.
    expect(can(g, { resource: 'class', action: 'create', ownerMemberId: 'kid-1' })).toBe(true);
    expect(can(g, { resource: 'class', action: 'update', ownerMemberId: 'kid-1' })).toBe(true);
    expect(can(g, { resource: 'member', action: 'delete', ownerMemberId: 'kid-1' })).toBe(false);
  });

  it('the guardian BASE role grants tenant-wide reads on shared reference data only', () => {
    // A guardian-only parent (no linked-minor edge here) can still browse the schedule, the arts the
    // dojo offers, and announcements — the same shared, non-sensitive set a member reads.
    const g = actor({ userId: 'u1', roles: [role('guardian')] });
    expect(can(g, { resource: 'class', action: 'list' })).toBe(true);
    expect(can(g, { resource: 'discipline', action: 'list' })).toBe(true);
    expect(can(g, { resource: 'announcement', action: 'list' })).toBe(true);
    // But NOT member-owned or staff data without a guardianship edge.
    expect(can(g, { resource: 'member', action: 'list' })).toBe(false);
    expect(can(g, { resource: 'invoice', action: 'list' })).toBe(false);
    expect(can(g, { resource: 'member', action: 'read', ownerMemberId: 'kid-1' })).toBe(false);
  });
});

describe('can() — custom roles', () => {
  it('honors an owner-defined custom role from the supplied catalog', () => {
    const a = actor({ roles: [role('custom:front-desk')] });
    const catalog = { 'custom:front-desk': [{ resource: 'member', action: 'read' } as const] };
    expect(can(a, { resource: 'member', action: 'read' }, { catalog })).toBe(true);
    expect(can(a, { resource: 'member', action: 'delete' }, { catalog })).toBe(false);
  });
});
