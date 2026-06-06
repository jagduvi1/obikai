import type {
  AuthPort,
  Identity,
  RegisterPasswordInput,
  VerifyPasswordInput,
} from '@obikai/adapter-contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService, InvalidCredentialsError } from './auth.service.js';
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
}

describe('AuthService', () => {
  let svc: AuthService;
  beforeEach(() => {
    const tokens = new TokenService(
      { jwtSecret: 'test-secret-which-is-long-enough-32', accessTtl: '15m', refreshTtl: '7d' },
      new MemSessions(),
    );
    svc = new AuthService(new FakeAuth(), tokens);
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
});
