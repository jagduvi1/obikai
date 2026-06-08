import { createHash, randomBytes } from 'node:crypto';
import type { AuthPort } from '@obikai/adapter-contracts';
import type { LoginInput, RegisterInput } from '@obikai/domain';
import type { IssuedTokens, SessionMeta, TokenService } from './token.service.js';

/**
 * AuthService (ADR-0012). Orchestrates the `auth-local` AuthPort (password verification only) and
 * the TokenService (sessions/JWT). Registration creates a tenant-GLOBAL account; membership to a
 * dojo is granted separately (staff invite, or the create-owner bootstrap) — registering does not
 * by itself grant access to any tenant.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

/** Raised when a password-reset token is unknown, already used, or expired. The controller maps this
 *  to a generic 400 — it must NOT reveal which of those it was (no oracle). */
export class InvalidResetTokenError extends Error {
  constructor() {
    super('invalid or expired password reset token');
    this.name = 'InvalidResetTokenError';
  }
}

/** Tenant-global account lookup by email — backed by the db IdentityRepository (local provider). */
export interface IdentityLookup {
  findByEmail(email: string): Promise<{ userId: string; email: string } | null>;
}

/** Tenant-global account lookup by id — backed by the db UserRepository. Needed to resolve the email
 *  for a password CHANGE, where the caller is identified by their session's userId, not their email. */
export interface UserLookup {
  findById(userId: string): Promise<{ email: string } | null>;
}

/** Persistence for single-use, time-boxed password-reset tokens — backed by the db repository. */
export interface PasswordResetStore {
  create(input: { userId: string; tokenHash: string; expiresAt: Date }): Promise<void>;
  consumeIfValid(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
  deleteByUserId(userId: string): Promise<void>;
}

/** The raw reset token + addressing the caller needs to email a reset link. The raw token is NEVER
 *  stored (only its sha256 is) — it exists only in this return value and the resulting email. */
export interface PasswordResetRequest {
  readonly userId: string;
  readonly email: string;
  readonly token: string;
  readonly expiresAt: string;
}

/**
 * Fast one-way hash for STORING/looking-up a high-entropy bearer token (the password-reset token is a
 * 256-bit `randomBytes` value). It is deliberately NOT a slow KDF: a memory-hard KDF exists to make
 * per-guess cost prohibitive for LOW-entropy human passwords, and buys nothing against a 2^256 keyspace
 * — while adding CPU to an unauthenticated endpoint (a DoS amplifier). The actual user password is
 * slow-hashed (scrypt/argon2id) inside the auth-local adapter via `auth.setPassword`, which is the
 * correct home for the KDF. This mirrors the refresh-token hashing in token.service.ts. CodeQL's
 * `js/insufficient-password-hash` here is a name-driven false positive (see ADR-0027); the value is a
 * token, never a password.
 */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class AuthService {
  constructor(
    private readonly auth: AuthPort,
    private readonly tokens: TokenService,
    private readonly identities: IdentityLookup,
    private readonly resetTokens: PasswordResetStore,
    private readonly users: UserLookup,
    private readonly resetTtlSeconds: number = 3_600,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: RegisterInput, meta: SessionMeta = {}): Promise<IssuedTokens> {
    await this.auth.registerPassword({ email: input.email, password: input.password });
    const identity = await this.auth.verifyPassword({
      email: input.email,
      password: input.password,
    });
    if (!identity) throw new InvalidCredentialsError(); // should not happen right after register
    return this.tokens.startSession(identity.subject, meta);
  }

  async login(input: LoginInput, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const identity = await this.auth.verifyPassword({
      email: input.email,
      password: input.password,
    });
    if (!identity) throw new InvalidCredentialsError();
    return this.tokens.startSession(identity.subject, meta);
  }

  async refresh(refreshToken: string, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const rotated = await this.tokens.rotate(refreshToken, meta);
    if (!rotated) throw new InvalidCredentialsError();
    return rotated;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  /**
   * Begin a password reset. Returns the raw token + canonical email when an account exists, or null
   * when it does NOT — the controller responds identically either way, so this never reveals whether
   * an email is registered (no account-enumeration oracle). Any prior unused token for the user is
   * invalidated first, so only the newest link works. The raw token is returned (never stored) for the
   * caller to email; only its sha256 is persisted.
   */
  async requestPasswordReset(email: string): Promise<PasswordResetRequest | null> {
    const normalized = email.trim().toLowerCase();
    const identity = await this.identities.findByEmail(normalized);
    if (!identity) return null;
    await this.resetTokens.deleteByUserId(identity.userId);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(this.now().getTime() + this.resetTtlSeconds * 1_000);
    await this.resetTokens.create({
      userId: identity.userId,
      tokenHash: sha256Hex(token),
      expiresAt,
    });
    return {
      userId: identity.userId,
      email: identity.email,
      token,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Complete a password reset: atomically consume the (single-use, unexpired) token, set the new
   * password, then revoke ALL of the user's refresh sessions so no device — including an attacker's —
   * can mint a new access token (any already-issued access token still lives out its short ~15min TTL;
   * see ADR-0027/token.service). Throws InvalidResetTokenError if the token is unknown/used/expired or
   * the account no longer has a local credential.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const consumed = await this.resetTokens.consumeIfValid(sha256Hex(token), this.now());
    if (!consumed) throw new InvalidResetTokenError();
    const updated = await this.auth.setPassword({
      subject: consumed.userId,
      password: newPassword,
    });
    if (!updated) throw new InvalidResetTokenError();
    await this.tokens.revokeAllSessions(consumed.userId);
  }

  /**
   * Change the password of an already-authenticated account (E3). Verifies the CURRENT password (so a
   * stolen access token alone cannot change it), sets the new one, then revokes EVERY refresh session
   * so no other device can mint a new access token, and mints a fresh session for the caller so they
   * stay logged in. (A thief's already-issued access token still expires within its short ~15min TTL —
   * the accepted stateless-JWT tradeoff; see ADR-0027.) Throws InvalidCredentialsError if the current
   * password is wrong or the account has no local credential. `userId` comes from the verified access
   * token, never the client body.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    meta: SessionMeta = {},
  ): Promise<IssuedTokens> {
    const user = await this.users.findById(userId);
    if (!user) throw new InvalidCredentialsError();
    const identity = await this.auth.verifyPassword({
      email: user.email,
      password: currentPassword,
    });
    // Defence in depth: the credential must resolve AND belong to the caller (email↔userId is 1:1).
    if (!identity || identity.subject !== userId) throw new InvalidCredentialsError();
    const updated = await this.auth.setPassword({ subject: userId, password: newPassword });
    if (!updated) throw new InvalidCredentialsError();
    await this.tokens.revokeAllSessions(userId);
    return this.tokens.startSession(userId, meta);
  }
}
