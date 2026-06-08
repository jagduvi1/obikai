import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/**
 * TokenService (ADR-0012). Mints short-lived access JWTs (jose HS256) carrying only
 * `{ sub: userId, sid: sessionId }` — never a tenant or roles — and manages opaque, rotating
 * refresh tokens with reuse detection. Sessions are persisted via an injected `SessionStore`
 * (the db `SessionRepository`), so this stays unit-testable with an in-memory fake.
 */

export interface AccessClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: string;
  readonly refreshExpiresAt: string;
}

export interface SessionMeta {
  readonly userAgent?: string | null;
  readonly ip?: string | null;
}

/** The session persistence surface TokenService needs — satisfied by @obikai/db SessionRepository. */
export interface SessionStore {
  create(input: {
    userId: string;
    family: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<{
    id: string;
    userId: string;
    family: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }>;
  findByRefreshHash(hash: string): Promise<{
    id: string;
    userId: string;
    family: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null>;
  /** Atomically retire a session iff still active; returns true if this call won (compare-and-swap). */
  revokeIfActive(id: string): Promise<boolean>;
  revokeFamily(family: string): Promise<void>;
  /** Retire EVERY active session for a user (logout-everywhere) — used on password reset/change. */
  revokeAllForUser(userId: string): Promise<void>;
}

export interface TokenConfig {
  readonly jwtSecret: string;
  readonly accessTtl: string;
  readonly refreshTtl: string;
}

/** Parse a `15m` / `7d` / `3600s` / `2h` TTL into seconds. */
export function parseTtlSeconds(ttl: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(ttl.trim());
  if (!match) {
    const asNumber = Number.parseInt(ttl, 10);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
    throw new Error(`invalid TTL: ${ttl}`);
  }
  const value = Number.parseInt(match[1]!, 10);
  const unit = match[2]!;
  const factor = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86_400;
  return value * factor;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class TokenService {
  readonly #key: Uint8Array;
  readonly #accessTtl: number;
  readonly #refreshTtl: number;
  readonly #sessions: SessionStore;
  readonly #now: () => Date;

  constructor(config: TokenConfig, sessions: SessionStore, now: () => Date = () => new Date()) {
    this.#key = new TextEncoder().encode(config.jwtSecret);
    this.#accessTtl = parseTtlSeconds(config.accessTtl);
    this.#refreshTtl = parseTtlSeconds(config.refreshTtl);
    this.#sessions = sessions;
    this.#now = now;
  }

  async #issueAccess(
    userId: string,
    sessionId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const iat = Math.floor(this.#now().getTime() / 1000);
    const exp = iat + this.#accessTtl;
    const token = await new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.#key);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.#key, { algorithms: ['HS256'] });
      const userId = typeof payload.sub === 'string' ? payload.sub : null;
      const sessionId = typeof payload.sid === 'string' ? payload.sid : null;
      if (!userId || !sessionId) return null;
      return { userId, sessionId };
    } catch {
      return null;
    }
  }

  /** Begin a new session (login) — fresh family, fresh refresh token. */
  async startSession(userId: string, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const family = randomBytes(16).toString('hex');
    return this.#mint(userId, family, meta);
  }

  /**
   * Rotate a refresh token. Returns new tokens, or null if the token is unknown/expired. REUSE
   * DETECTION: a token that is found but already revoked (because it was rotated) means someone is
   * replaying a retired token — revoke the entire family so neither party can continue.
   */
  async rotate(refreshToken: string, meta: SessionMeta = {}): Promise<IssuedTokens | null> {
    const hash = sha256Hex(refreshToken);
    const session = await this.#sessions.findByRefreshHash(hash);
    if (!session) return null; // never issued
    if (session.revokedAt !== null) {
      await this.#sessions.revokeFamily(session.family); // replay of a retired token → kill family
      return null;
    }
    if (session.expiresAt.getTime() <= this.#now().getTime()) {
      await this.#sessions.revokeIfActive(session.id);
      return null;
    }
    // Atomically retire the presented token. If we lose the CAS, a concurrent request (or a
    // replay) already rotated it → treat as reuse and kill the family.
    const won = await this.#sessions.revokeIfActive(session.id);
    if (!won) {
      await this.#sessions.revokeFamily(session.family);
      return null;
    }
    return this.#mint(session.userId, session.family, meta);
  }

  /** Revoke a session family (logout). Safe to call with an unknown token (no-op). */
  async revoke(refreshToken: string): Promise<void> {
    const session = await this.#sessions.findByRefreshHash(sha256Hex(refreshToken));
    if (session) await this.#sessions.revokeFamily(session.family);
  }

  /** Revoke ALL of a user's sessions (logout-everywhere) — called after a password reset or change so
   *  a leaked/old credential's live sessions cannot outlive the credential it authenticated with. */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.#sessions.revokeAllForUser(userId);
  }

  async #mint(userId: string, family: string, meta: SessionMeta): Promise<IssuedTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(this.#now().getTime() + this.#refreshTtl * 1000);
    const session = await this.#sessions.create({
      userId,
      family,
      refreshTokenHash: sha256Hex(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });
    const access = await this.#issueAccess(userId, session.id);
    return {
      accessToken: access.token,
      refreshToken,
      accessExpiresAt: access.expiresAt,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }
}
