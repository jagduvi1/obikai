import { beforeEach, describe, expect, it } from 'vitest';
import { type SessionStore, TokenService, parseTtlSeconds } from './token.service.js';

interface Row {
  id: string;
  userId: string;
  family: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** In-memory SessionStore — keeps rotated (revoked) rows so reuse detection can find them. */
class MemSessions implements SessionStore {
  readonly rows = new Map<string, Row>();
  private seq = 0;

  async create(input: {
    userId: string;
    family: string;
    refreshTokenHash: string;
    expiresAt: Date;
  }): Promise<Row> {
    const id = `s${++this.seq}`;
    const row: Row = { id, ...input, revokedAt: null };
    this.rows.set(id, row);
    return { ...row };
  }
  async findByRefreshHash(hash: string): Promise<Row | null> {
    for (const r of this.rows.values()) if (r.refreshTokenHash === hash) return { ...r };
    return null;
  }
  async revokeIfActive(id: string): Promise<boolean> {
    const r = this.rows.get(id);
    if (r && r.revokedAt === null) {
      r.revokedAt = new Date();
      return true;
    }
    return false;
  }
  async revokeFamily(family: string): Promise<void> {
    for (const r of this.rows.values()) if (r.family === family) r.revokedAt = new Date();
  }
}

const config = {
  jwtSecret: 'test-secret-which-is-long-enough-32',
  accessTtl: '15m',
  refreshTtl: '7d',
};

describe('parseTtlSeconds', () => {
  it('parses units', () => {
    expect(parseTtlSeconds('15m')).toBe(900);
    expect(parseTtlSeconds('7d')).toBe(604_800);
    expect(parseTtlSeconds('30s')).toBe(30);
    expect(parseTtlSeconds('2h')).toBe(7200);
  });
});

describe('TokenService', () => {
  let sessions: MemSessions;
  let svc: TokenService;
  beforeEach(() => {
    sessions = new MemSessions();
    svc = new TokenService(config, sessions);
  });

  it('issues an access token that verifies to the user + session', async () => {
    const tokens = await svc.startSession('user-1');
    const claims = await svc.verifyAccess(tokens.accessToken);
    expect(claims?.userId).toBe('user-1');
    expect(typeof claims?.sessionId).toBe('string');
  });

  it('rejects a malformed or tampered access token', async () => {
    expect(await svc.verifyAccess('not-a-jwt')).toBeNull();
    const tokens = await svc.startSession('user-1');
    expect(await svc.verifyAccess(`${tokens.accessToken}x`)).toBeNull();
  });

  it('rotates the refresh token, retiring the old one', async () => {
    const first = await svc.startSession('user-1');
    const second = await svc.rotate(first.refreshToken);
    expect(second).not.toBeNull();
    expect(second?.refreshToken).not.toBe(first.refreshToken);
    // The original token is now retired — rotating it again must fail.
    expect(await svc.rotate(first.refreshToken)).toBeNull();
  });

  it('detects reuse of a retired token and revokes the whole family', async () => {
    const first = await svc.startSession('user-1');
    const second = await svc.rotate(first.refreshToken); // first now revoked-but-stored
    expect(second).not.toBeNull();

    // Attacker replays the retired token → reuse detected → family revoked.
    expect(await svc.rotate(first.refreshToken)).toBeNull();

    // The legitimate (rotated) token is now dead too, because the family was killed.
    expect(await svc.rotate(second?.refreshToken ?? '')).toBeNull();
  });

  it('rejects an unknown refresh token', async () => {
    expect(await svc.rotate('totally-unknown')).toBeNull();
  });

  it('a concurrent double-rotate yields exactly one survivor, then the family is killed', async () => {
    const first = await svc.startSession('user-1');
    // Two requests present the SAME token concurrently — only one CAS wins.
    const [a, b] = await Promise.all([
      svc.rotate(first.refreshToken),
      svc.rotate(first.refreshToken),
    ]);
    const winners = [a, b].filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    // The race tripped reuse detection → the winner's token is also dead now.
    const survivor = winners[0]!;
    expect(await svc.rotate(survivor.refreshToken)).toBeNull();
  });

  it('logout revokes the family so the refresh token stops working', async () => {
    const tokens = await svc.startSession('user-1');
    await svc.revoke(tokens.refreshToken);
    expect(await svc.rotate(tokens.refreshToken)).toBeNull();
  });
});
