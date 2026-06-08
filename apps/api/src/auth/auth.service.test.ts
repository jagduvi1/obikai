import type {
  AuthPort,
  Identity,
  RegisterPasswordInput,
  SetPasswordInput,
  VerifyPasswordInput,
} from '@obikai/adapter-contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthService,
  type IdentityLookup,
  InvalidCredentialsError,
  InvalidResetTokenError,
  type PasswordResetStore,
} from './auth.service.js';
import { type SessionStore, TokenService } from './token.service.js';

/** Minimal in-memory AuthPort + SessionStore so we exercise the real AuthService + TokenService. */
class FakeAuth implements AuthPort {
  readonly kind = 'auth' as const;
  readonly providerId = 'fake';
  readonly capabilities = new Set<'password' | 'mfa-totp' | 'oidc'>(['password']);
  private readonly creds = new Map<string, { subject: string; password: string }>();
  private seq = 0;
  async init(): Promise<void> {}
  async dispose(): Promise<void> {}
  async health() {
    return { ok: true };
  }
  async registerPassword(input: RegisterPasswordInput): Promise<Identity> {
    const email = input.email.toLowerCase();
    if (this.creds.has(email)) throw new Error('exists');
    const subject = `u${++this.seq}`;
    this.creds.set(email, { subject, password: input.password });
    return { subject, email, emailVerified: false, provider: 'fake', tenantScoped: false };
  }
  async verifyPassword(input: VerifyPasswordInput): Promise<Identity | null> {
    const email = input.email.toLowerCase();
    const cred = this.creds.get(email);
    if (!cred || cred.password !== input.password) return null;
    return {
      subject: cred.subject,
      email,
      emailVerified: false,
      provider: 'fake',
      tenantScoped: false,
    };
  }
  async setPassword(input: SetPasswordInput): Promise<boolean> {
    for (const cred of this.creds.values()) {
      if (cred.subject === input.subject) {
        cred.password = input.password;
        return true;
      }
    }
    return false;
  }
  /** Helper backing the IdentityLookup fake — resolve {userId,email} for a (normalised) email. */
  lookupByEmail(email: string): { userId: string; email: string } | null {
    const cred = this.creds.get(email.toLowerCase());
    return cred ? { userId: cred.subject, email: email.toLowerCase() } : null;
  }
}

/** In-memory single-use reset-token store mirroring PasswordResetTokenRepository semantics. */
class MemResetTokens implements PasswordResetStore {
  readonly rows = new Map<string, { userId: string; expiresAt: Date; usedAt: Date | null }>();
  async create(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    this.rows.set(input.tokenHash, {
      userId: input.userId,
      expiresAt: input.expiresAt,
      usedAt: null,
    });
  }
  async consumeIfValid(tokenHash: string, now: Date) {
    const row = this.rows.get(tokenHash);
    if (!row || row.usedAt !== null || row.expiresAt.getTime() <= now.getTime()) return null;
    row.usedAt = now;
    return { userId: row.userId };
  }
  async deleteByUserId(userId: string) {
    for (const [hash, row] of this.rows) if (row.userId === userId) this.rows.delete(hash);
  }
}

class MemSessions implements SessionStore {
  private readonly rows = new Map<
    string,
    {
      id: string;
      userId: string;
      family: string;
      refreshTokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
    }
  >();
  private seq = 0;
  async create(input: {
    userId: string;
    family: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }) {
    const id = `s${++this.seq}`;
    const row = { id, ...input, revokedAt: null };
    this.rows.set(id, row);
    return { ...row };
  }
  async findByRefreshHash(hash: string) {
    for (const r of this.rows.values()) if (r.refreshTokenHash === hash) return { ...r };
    return null;
  }
  async revokeIfActive(id: string) {
    const r = this.rows.get(id);
    if (r && r.revokedAt === null) {
      r.revokedAt = new Date();
      return true;
    }
    return false;
  }
  async revokeFamily(family: string) {
    for (const r of this.rows.values()) if (r.family === family) r.revokedAt = new Date();
  }
  async revokeAllForUser(userId: string) {
    for (const r of this.rows.values()) if (r.userId === userId) r.revokedAt = new Date();
  }
}

describe('AuthService', () => {
  let svc: AuthService;
  let auth: FakeAuth;
  let resetTokens: MemResetTokens;
  beforeEach(() => {
    const tokens = new TokenService(
      { jwtSecret: 'test-secret-which-is-long-enough-32', accessTtl: '15m', refreshTtl: '7d' },
      new MemSessions(),
    );
    auth = new FakeAuth();
    resetTokens = new MemResetTokens();
    const identities: IdentityLookup = { findByEmail: async (e) => auth.lookupByEmail(e) };
    svc = new AuthService(auth, tokens, identities, resetTokens);
  });

  it('registers then issues a working session', async () => {
    const tokens = await svc.register({
      email: 'a@example.com',
      password: 'correct-horse-battery',
    });
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
  });

  it('logs in with correct credentials and rejects wrong ones', async () => {
    await svc.register({ email: 'a@example.com', password: 'correct-horse-battery' });
    const ok = await svc.login({ email: 'a@example.com', password: 'correct-horse-battery' });
    expect(ok.accessToken).toBeTruthy();
    await expect(svc.login({ email: 'a@example.com', password: 'wrong' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    await expect(svc.login({ email: 'nobody@example.com', password: 'x' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('refreshes a session and rejects a bad refresh token', async () => {
    const t = await svc.register({ email: 'a@example.com', password: 'correct-horse-battery' });
    const rotated = await svc.refresh(t.refreshToken);
    expect(rotated.accessToken).toBeTruthy();
    await expect(svc.refresh('garbage')).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('requestPasswordReset returns a token for a known account and null for an unknown one (no enumeration)', async () => {
    await svc.register({ email: 'a@example.com', password: 'original-password' });
    const req = await svc.requestPasswordReset('A@Example.com'); // case-insensitive
    expect(req).not.toBeNull();
    expect(req?.email).toBe('a@example.com');
    expect(req?.token).toBeTruthy();
    // Unknown email → null (the controller returns the same 204 either way).
    expect(await svc.requestPasswordReset('nobody@example.com')).toBeNull();
  });

  it('confirmPasswordReset sets the new password, consumes the token (single-use), and logs out everywhere', async () => {
    const initial = await svc.register({ email: 'a@example.com', password: 'original-password' });
    const req = await svc.requestPasswordReset('a@example.com');
    const token = req!.token;

    await svc.confirmPasswordReset(token, 'a-brand-new-password');

    // Old password rejected, new password works.
    await expect(
      svc.login({ email: 'a@example.com', password: 'original-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    const relogin = await svc.login({ email: 'a@example.com', password: 'a-brand-new-password' });
    expect(relogin.accessToken).toBeTruthy();

    // The reset logged out existing sessions: the pre-reset refresh token is dead.
    await expect(svc.refresh(initial.refreshToken)).rejects.toBeInstanceOf(InvalidCredentialsError);

    // The token is single-use: replaying it fails.
    await expect(svc.confirmPasswordReset(token, 'another-one')).rejects.toBeInstanceOf(
      InvalidResetTokenError,
    );
  });

  it('confirmPasswordReset rejects an unknown/garbage token', async () => {
    await expect(svc.confirmPasswordReset('not-a-real-token', 'whatever')).rejects.toBeInstanceOf(
      InvalidResetTokenError,
    );
  });

  it('issuing a new reset token invalidates the previous one', async () => {
    await svc.register({ email: 'a@example.com', password: 'original-password' });
    const first = await svc.requestPasswordReset('a@example.com');
    const second = await svc.requestPasswordReset('a@example.com');
    expect(first?.token).not.toBe(second?.token);
    // The first (superseded) token no longer works …
    await expect(svc.confirmPasswordReset(first!.token, 'x-password')).rejects.toBeInstanceOf(
      InvalidResetTokenError,
    );
    // … only the newest does.
    await svc.confirmPasswordReset(second!.token, 'y-password');
    const ok = await svc.login({ email: 'a@example.com', password: 'y-password' });
    expect(ok.accessToken).toBeTruthy();
  });
});
