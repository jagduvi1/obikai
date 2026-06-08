import { createHash, randomBytes } from 'node:crypto';
import { EmailAlreadyRegisteredError } from '@obikai/adapter-auth-local';
import { type AuthzActor, can } from '@obikai/authz';
import type { AuditAppendInput } from '@obikai/db';
import type { Member, RoleAssignment, UserId } from '@obikai/domain';
import { ForbiddenError, NotFoundError } from './members.service.js';

/**
 * MemberInviteService — member onboarding (linking a tenant member to a portal login). Two halves:
 *
 *  • createInvite (staff, inside the tenant): mint a single-use, time-boxed token for a member that has
 *    an email and no account yet, and hand the raw token back for the caller to email.
 *  • acceptInvite (PUBLIC, no tenant context): the invited person sets a password; we create their
 *    tenant-global account, then — INSIDE the tenant carried by the trusted token — grant a `member`
 *    Membership and atomically link the member, and auto-login.
 *
 * Framework-free (no Nest); the tenant-crossing is injected as `withTenant` so this unit-tests against
 * light fakes. The token is the only secret: only sha256(token) is stored, it is single-use (the store
 * CAS-consumes it), so two concurrent accepts can never both proceed.
 */

export class InviteNoEmailError extends Error {
  constructor() {
    super('member has no email to invite');
    this.name = 'InviteNoEmailError';
  }
}
export class InviteAlreadyLinkedError extends Error {
  constructor() {
    super('member already has an account');
    this.name = 'InviteAlreadyLinkedError';
  }
}
/** The invite token is unknown, already used, or expired (controller maps to a generic 400). */
export class InvalidInviteTokenError extends Error {
  constructor() {
    super('invalid or expired invite token');
    this.name = 'InvalidInviteTokenError';
  }
}
/** The invited email already has an account (409) — they should sign in, not accept a new invite. */
export class InviteEmailTakenError extends Error {
  constructor() {
    super('an account already exists for this email');
    this.name = 'InviteEmailTakenError';
  }
}

export interface InviteMemberStore {
  findById(id: string): Promise<Member | null>;
  /** CAS link: true only if the member existed AND had no account yet. */
  linkUserId(memberId: string, userId: string): Promise<boolean>;
}
export interface InviteTokenStore {
  create(input: {
    tenantId: string;
    memberId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeIfValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ tenantId: string; memberId: string; email: string } | null>;
  deleteByMemberId(memberId: string): Promise<void>;
}
export interface InviteAccountPort {
  /** Create a tenant-global local account; throws EmailAlreadyRegisteredError if the email is taken. */
  registerPassword(input: { email: string; password: string }): Promise<{ subject: string }>;
}
export interface InviteMembershipPort {
  create(input: {
    userId: string;
    memberId: string;
    roles: readonly RoleAssignment[];
    status?: 'active' | 'suspended';
  }): Promise<unknown>;
}
export interface InviteSessionPort {
  startSession(
    userId: string,
    meta?: { userAgent?: string | null; ip?: string | null },
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  }>;
}
export interface InviteVerifierPort {
  /** Flip emailVerified (the invite link proves the person controls the address). */
  markVerified(userId: string): Promise<void>;
}
export interface InviteAuditPort {
  append(input: AuditAppendInput): Promise<unknown>;
}

export interface MemberInviteRequest {
  readonly token: string;
  readonly email: string;
  readonly memberName: string;
}

export interface MemberInviteDeps {
  readonly members: InviteMemberStore;
  readonly invites: InviteTokenStore;
  readonly account: InviteAccountPort;
  readonly memberships: InviteMembershipPort;
  readonly sessions: InviteSessionPort;
  readonly verifier: InviteVerifierPort;
  readonly audit: InviteAuditPort;
  /** Run `fn` inside an explicit tenant context for `tenantId` acting as `userId` (system onboarding). */
  readonly withTenant: <T>(tenantId: string, userId: string, fn: () => Promise<T>) => Promise<T>;
  readonly inviteTtlSeconds?: number;
  readonly now?: () => Date;
}

const MEMBER_ROLE: RoleAssignment = { role: 'member', locationScope: 'ALL' };

function sha256Hex(value: string): string {
  // Fast hash of a 256-bit CSPRNG bearer token (not a password) — see ADR-0027.
  return createHash('sha256').update(value).digest('hex');
}

export class MemberInviteService {
  private readonly d: MemberInviteDeps;
  private readonly ttl: number;
  private readonly now: () => Date;

  constructor(deps: MemberInviteDeps) {
    this.d = deps;
    this.ttl = deps.inviteTtlSeconds ?? 7 * 24 * 3_600; // 7 days
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Mint an invite for a member (staff action, inside the tenant). Returns the raw token + addressing
   * for the caller to email. Throws if the actor lacks `member:update`, the member has no email, or the
   * member already has an account. Supersedes any prior outstanding invite for the member.
   */
  async createInvite(
    actor: AuthzActor,
    tenantId: string,
    memberId: string,
  ): Promise<MemberInviteRequest> {
    if (!can(actor, { resource: 'member', action: 'update', ownerMemberId: memberId })) {
      throw new ForbiddenError('invite', 'member');
    }
    const member = await this.d.members.findById(memberId);
    if (!member) throw new NotFoundError('member', memberId);
    if (!member.email) throw new InviteNoEmailError();
    if (member.userId !== null) throw new InviteAlreadyLinkedError();

    await this.d.invites.deleteByMemberId(memberId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + this.ttl * 1_000);
    await this.d.invites.create({
      tenantId,
      memberId,
      email: member.email,
      tokenHash: sha256Hex(token),
      expiresAt,
    });
    await this.d.audit.append({
      actorId: actor.userId as UserId,
      actorType: 'user',
      action: 'member.invite',
      targetType: 'member',
      targetId: memberId,
    });
    return {
      token,
      email: member.email,
      memberName: `${member.firstName} ${member.lastName}`.trim(),
    };
  }

  /**
   * Accept an invite (public). Atomically consumes the token, creates the account, then — inside the
   * tenant the token carries — links the member and grants a `member` Membership, and auto-logs-in.
   *
   * Ordering is deliberate: the token CAS makes us the sole accepter; we then re-check the member is
   * still unlinked, create the account, CAS-link the member (belt-and-suspenders against a hijack), and
   * only then create the Membership — so a created account can never be linked to the wrong member.
   */
  async acceptInvite(
    token: string,
    password: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  }> {
    const consumed = await this.d.invites.consumeIfValid(sha256Hex(token), this.now());
    if (!consumed) throw new InvalidInviteTokenError();
    const { tenantId, memberId, email } = consumed;

    // Re-check the member is still present + unlinked, in its tenant, BEFORE creating an account.
    await this.d.withTenant(tenantId, 'invite-accept', async () => {
      const member = await this.d.members.findById(memberId);
      if (!member || member.userId !== null) throw new InvalidInviteTokenError();
    });

    // Create the tenant-global account. If the email already has one, stop (no orphan, token spent).
    let userId: string;
    try {
      const identity = await this.d.account.registerPassword({ email, password });
      userId = identity.subject;
    } catch (err) {
      if (err instanceof EmailAlreadyRegisteredError) throw new InviteEmailTakenError();
      throw err;
    }
    // The invite link proves the person controls this address → verified.
    await this.d.verifier.markVerified(userId);

    // Inside the tenant: CAS-link the member to this account, then grant the member role, then record
    // the onboarding on the tenant audit chain (a new account + membership is an accountable event).
    await this.d.withTenant(tenantId, userId, async () => {
      const linked = await this.d.members.linkUserId(memberId, userId);
      if (!linked) throw new InvalidInviteTokenError(); // lost a race / member changed under us
      await this.d.memberships.create({
        userId,
        memberId,
        roles: [MEMBER_ROLE],
        status: 'active',
      });
      await this.d.audit.append({
        actorId: userId as UserId,
        actorType: 'user',
        action: 'member.invite_accepted',
        targetType: 'member',
        targetId: memberId,
      });
    });

    return this.d.sessions.startSession(userId, meta);
  }
}
