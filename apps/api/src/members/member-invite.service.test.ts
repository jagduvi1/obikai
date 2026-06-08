import { EmailAlreadyRegisteredError } from '@obikai/adapter-auth-local';
import type { AuthzActor } from '@obikai/authz';
import type { Member } from '@obikai/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvalidInviteTokenError,
  InviteAlreadyLinkedError,
  InviteEmailTakenError,
  InviteNoEmailError,
  MemberInviteService,
} from './member-invite.service.js';
import { ForbiddenError } from './members.service.js';

const owner: AuthzActor = { userId: 'staff-1', roles: [{ role: 'owner', locationScope: 'ALL' }] };
const noRights: AuthzActor = { userId: 'u-x', roles: [] };

function member(over: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    tenantId: 't1',
    userId: null,
    householdId: null,
    firstName: 'Mei',
    lastName: 'Tan',
    email: 'mei@example.com',
    phone: null,
    dateOfBirth: null,
    status: 'active',
    joinDate: null,
    emergencyContact: null,
    notes: null,
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  } as Member;
}

class FakeMembers {
  readonly byId = new Map<string, Member>();
  async findById(id: string) {
    return this.byId.get(id) ?? null;
  }
  async linkUserId(memberId: string, userId: string) {
    const m = this.byId.get(memberId);
    if (!m || m.userId !== null) return false;
    this.byId.set(memberId, { ...m, userId } as Member);
    return true;
  }
}

class FakeInvites {
  readonly rows = new Map<
    string,
    { tenantId: string; memberId: string; email: string; expiresAt: Date; usedAt: Date | null }
  >();
  async create(i: {
    tenantId: string;
    memberId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    this.rows.set(i.tokenHash, {
      tenantId: i.tenantId,
      memberId: i.memberId,
      email: i.email,
      expiresAt: i.expiresAt,
      usedAt: null,
    });
  }
  async consumeIfValid(tokenHash: string, now: Date) {
    const r = this.rows.get(tokenHash);
    if (!r || r.usedAt !== null || r.expiresAt.getTime() <= now.getTime()) return null;
    r.usedAt = now;
    return { tenantId: r.tenantId, memberId: r.memberId, email: r.email };
  }
  async deleteByMemberId(memberId: string) {
    for (const [h, r] of this.rows) if (r.memberId === memberId) this.rows.delete(h);
  }
}

class FakeAccount {
  readonly emails = new Set<string>();
  seq = 0;
  async registerPassword(input: { email: string; password: string }) {
    if (this.emails.has(input.email)) throw new EmailAlreadyRegisteredError(input.email);
    this.emails.add(input.email);
    return { subject: `user-${++this.seq}` };
  }
}

describe('MemberInviteService', () => {
  let members: FakeMembers;
  let invites: FakeInvites;
  let account: FakeAccount;
  let memberships: { create: ReturnType<typeof vi.fn> };
  let verifier: { markVerified: ReturnType<typeof vi.fn> };
  let audit: { append: ReturnType<typeof vi.fn> };
  let sessions: { startSession: ReturnType<typeof vi.fn> };
  let svc: MemberInviteService;

  beforeEach(() => {
    members = new FakeMembers();
    members.byId.set('m1', member());
    invites = new FakeInvites();
    account = new FakeAccount();
    memberships = { create: vi.fn().mockResolvedValue(undefined) };
    verifier = { markVerified: vi.fn().mockResolvedValue(undefined) };
    audit = { append: vi.fn().mockResolvedValue(undefined) };
    sessions = {
      startSession: vi.fn().mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        accessExpiresAt: 'ax',
        refreshExpiresAt: 'rx',
      }),
    };
    svc = new MemberInviteService({
      members,
      invites,
      account,
      memberships,
      sessions,
      verifier,
      audit,
      withTenant: (_tid, _uid, fn) => fn(),
    });
  });

  describe('createInvite', () => {
    it('mints an invite for a member with an email and no account', async () => {
      const req = await svc.createInvite(owner, 't1', 'm1');
      expect(req.token).toBeTruthy();
      expect(req.email).toBe('mei@example.com');
      expect(req.memberName).toBe('Mei Tan');
      expect(invites.rows.size).toBe(1);
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'member.invite' }),
      );
    });

    it('refuses an actor without member:update', async () => {
      await expect(svc.createInvite(noRights, 't1', 'm1')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('refuses a member with no email', async () => {
      members.byId.set('m1', member({ email: null }));
      await expect(svc.createInvite(owner, 't1', 'm1')).rejects.toBeInstanceOf(InviteNoEmailError);
    });

    it('refuses a member that already has an account', async () => {
      members.byId.set('m1', member({ userId: 'user-9' as Member['userId'] }));
      await expect(svc.createInvite(owner, 't1', 'm1')).rejects.toBeInstanceOf(
        InviteAlreadyLinkedError,
      );
    });

    it('supersedes a prior outstanding invite (only the newest works)', async () => {
      const first = await svc.createInvite(owner, 't1', 'm1');
      const second = await svc.createInvite(owner, 't1', 'm1');
      expect(invites.rows.size).toBe(1); // the first was deleted
      expect(first.token).not.toBe(second.token);
    });
  });

  describe('acceptInvite', () => {
    it('creates the account, links the member, grants membership, verifies, audits, and logs in', async () => {
      const { token } = await svc.createInvite(owner, 't1', 'm1');
      const tokens = await svc.acceptInvite(token, 'a-strong-password');

      expect(tokens.accessToken).toBe('a');
      expect((await members.findById('m1'))?.userId).toBe('user-1'); // linked
      expect(memberships.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          memberId: 'm1',
          roles: [{ role: 'member', locationScope: 'ALL' }],
          status: 'active',
        }),
      );
      expect(verifier.markVerified).toHaveBeenCalledWith('user-1');
      expect(audit.append).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'member.invite_accepted', targetId: 'm1' }),
      );
      expect(sessions.startSession).toHaveBeenCalledWith('user-1', {});
    });

    it('is single-use: replaying the token fails and creates no second account', async () => {
      const { token } = await svc.createInvite(owner, 't1', 'm1');
      await svc.acceptInvite(token, 'a-strong-password');
      await expect(svc.acceptInvite(token, 'another-password')).rejects.toBeInstanceOf(
        InvalidInviteTokenError,
      );
      expect(account.seq).toBe(1); // only one account ever created
    });

    it('rejects an unknown/garbage token without touching the account store', async () => {
      await expect(svc.acceptInvite('nope', 'a-strong-password')).rejects.toBeInstanceOf(
        InvalidInviteTokenError,
      );
      expect(account.seq).toBe(0);
    });

    it('rejects when the email already has an account (409) — token is spent, no link', async () => {
      account.emails.add('mei@example.com'); // pre-existing account
      const { token } = await svc.createInvite(owner, 't1', 'm1');
      await expect(svc.acceptInvite(token, 'a-strong-password')).rejects.toBeInstanceOf(
        InviteEmailTakenError,
      );
      expect((await members.findById('m1'))?.userId).toBeNull(); // not linked
    });

    it('rejects if the member was linked between mint and accept (pre-check)', async () => {
      const { token } = await svc.createInvite(owner, 't1', 'm1');
      members.byId.set('m1', member({ userId: 'someone-else' as Member['userId'] }));
      await expect(svc.acceptInvite(token, 'a-strong-password')).rejects.toBeInstanceOf(
        InvalidInviteTokenError,
      );
      expect(account.seq).toBe(0); // no account created
    });
  });
});
