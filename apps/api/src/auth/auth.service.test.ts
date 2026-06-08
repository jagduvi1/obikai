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
  InvalidVerificationTokenError,
  type PasswordResetStore,
  type UserLookup,
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
  /** Helper backing the UserLookup fake — resolve {email} for a subject (userId). */
  lookupById(userId: string): { email: string } | null {
    for (const [email, cred] of this.creds) if (cred.subject === userId) return { email };
    return null;
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
  let verifyTokens: MemResetTokens;
  let verified: Set<string>;
  beforeEach(() => {
    const tokens = new TokenService(
      { jwtSecret: 'test-secret-which-is-long-enough-32', accessTtl: '15m', refreshTtl: '7d' },
      new MemSessions(),
    );
    auth = new FakeAuth();
    resetTokens = new MemResetTokens();
    verifyTokens = new MemResetTokens(); // same single-use-token contract as the reset store
    verified = new Set<string>();
    const identities: IdentityLookup = { findByEmail: async (e) => auth.lookupByEmail(e) };
    const users: UserLookup = { findById: async (id) => auth.lookupById(id) };
    const emailVerifier = {
      markVerified: async (id: string): Promise<void> => {
        verified.add(id);
      },
    };
    svc = new AuthService({
      auth,
      tokens,
      identities,
      users,
      resetTokens,
      verifyTokens,
      emailVerifier,
    });
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

  it('changePassword verifies the current password, sets the new one, and returns a fresh session', async () => {
    const initial = await svc.register({ email: 'a@example.com', password: 'original-password' });
    // The userId is whatever the verified access token resolves to — here, the registered subject.
    const userId = auth.lookupByEmail('a@example.com')!.userId;

    const issued = await svc.changePassword(userId, 'original-password', 'totally-new-password');
    expect(issued.accessToken).toBeTruthy();

    // Old password rejected, new one works.
    await expect(
      svc.login({ email: 'a@example.com', password: 'original-password' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(
      (await svc.login({ email: 'a@example.com', password: 'totally-new-password' })).accessToken,
    ).toBeTruthy();

    // Sessions minted before the change are revoked (logout-everywhere).
    await expect(svc.refresh(initial.refreshToken)).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('changePassword rejects a wrong current password and leaves the password unchanged', async () => {
    await svc.register({ email: 'a@example.com', password: 'original-password' });
    const userId = auth.lookupByEmail('a@example.com')!.userId;
    await expect(
      svc.changePassword(userId, 'WRONG-current', 'totally-new-password'),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    // Original still works — nothing changed.
    expect(
      (await svc.login({ email: 'a@example.com', password: 'original-password' })).accessToken,
    ).toBeTruthy();
  });

  it('requestEmailVerification returns a token for a known account and null for an unknown one', async () => {
    await svc.register({ email: 'a@example.com', password: 'original-password' });
    const req = await svc.requestEmailVerification('A@Example.com'); // case-insensitive
    expect(req?.email).toBe('a@example.com');
    expect(req?.token).toBeTruthy();
    expect(await svc.requestEmailVerification('nobody@example.com')).toBeNull();
  });

  it('confirmEmailVerification marks the account verified and is single-use', async () => {
    await svc.register({ email: 'a@example.com', password: 'original-password' });
    const userId = auth.lookupByEmail('a@example.com')!.userId;
    const req = await svc.requestEmailVerification('a@example.com');

    expect(verified.has(userId)).toBe(false);
    await svc.confirmEmailVerification(req!.token);
    expect(verified.has(userId)).toBe(true);

    // The token is single-use: replaying it fails.
    await expect(svc.confirmEmailVerification(req!.token)).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
  });

  it('confirmEmailVerification rejects an unknown token', async () => {
    await expect(svc.confirmEmailVerification('not-a-real-token')).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
  });

  it('issuing a new verification token invalidates the previous one', async () => {
    await svc.register({ email: 'a@example.com', password: 'original-password' });
    const first = await svc.requestEmailVerification('a@example.com');
    const second = await svc.requestEmailVerification('a@example.com');
    expect(first?.token).not.toBe(second?.token);
    await expect(svc.confirmEmailVerification(first!.token)).rejects.toBeInstanceOf(
      InvalidVerificationTokenError,
    );
    await svc.confirmEmailVerification(second!.token); // newest works
  });
});
