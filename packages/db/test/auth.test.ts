/**
 * Auth persistence tests (ADR-0012). Verifies that User/Identity are TENANT-GLOBAL (usable with NO
 * tenant context — the deliberate guard exemption) while Membership IS tenant-scoped, and that the
 * request-context bootstrap lookup resolves the right tenant's membership. Requires a downloaded
 * mongodb-memory-server binary.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EmailVerificationTokenRepository,
  IdentityModel,
  IdentityRepository,
  MembershipModel,
  MembershipRepository,
  PasswordResetTokenModel,
  PasswordResetTokenRepository,
  UserModel,
  UserRepository,
} from '../src/auth.js';
import { MissingTenantContextError } from '../src/errors.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string, userId = 'u1'): TenantContext => ({
  tenantId,
  userId,
  sessionId: null,
  roles: [{ role: 'owner', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const users = new UserRepository();
const identities = new IdentityRepository();
const memberships = new MembershipRepository();
const resetTokens = new PasswordResetTokenRepository();
const verifyTokens = new EmailVerificationTokenRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([UserModel.syncIndexes(), MembershipModel.syncIndexes()]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('users').deleteMany({});
  await mongoose.connection.collection('identities').deleteMany({});
  await mongoose.connection.collection('memberships').deleteMany({});
  await mongoose.connection.collection('passwordresettokens').deleteMany({});
  await mongoose.connection.collection('emailverificationtokens').deleteMany({});
});

describe('guard exemption is deliberate (ADR-0004/0012)', () => {
  it('global schemas have NO tenantId path; Membership does', () => {
    // The structural proof that tenant-global collections are intentionally exempt from tenantGuard
    // (which adds a required `tenantId`), while the tenant-scoped one is guarded.
    expect(UserModel.schema.path('tenantId')).toBeUndefined();
    expect(IdentityModel.schema.path('tenantId')).toBeUndefined();
    expect(MembershipModel.schema.path('tenantId')).toBeDefined();
  });
});

describe('tenant-global identity (no guard)', () => {
  it('creates and reads a User with NO tenant context', async () => {
    const user = await users.create({ email: 'Owner@Example.com', emailVerified: true });
    expect(user.id).toBeTruthy();
    const found = await users.findById(user.id);
    expect(found?.email).toBe('Owner@Example.com');
  });

  it('stores and finds a local credential globally by email', async () => {
    const user = await users.create({ email: 'a@example.com' });
    await identities.create({
      userId: user.id,
      provider: 'local',
      email: 'a@example.com',
      passwordHash: 'h',
      emailVerified: false,
    });
    const rec = await identities.findByEmailLower('local', 'a@example.com');
    expect(rec?.userId).toBe(user.id);
  });

  it('updatePasswordHashByUserId replaces the hash and reports whether it matched', async () => {
    const user = await users.create({ email: 'reset@example.com' });
    await identities.create({
      userId: user.id,
      provider: 'local',
      email: 'reset@example.com',
      passwordHash: 'old-hash',
      emailVerified: false,
    });
    const matched = await identities.updatePasswordHashByUserId(user.id, 'new-hash');
    expect(matched).toBe(true);
    const rec = await identities.findByEmailLower('local', 'reset@example.com');
    expect(rec?.passwordHash).toBe('new-hash');
    // Unknown user → no match.
    expect(await identities.updatePasswordHashByUserId('nope', 'x')).toBe(false);
  });

  it('markEmailVerified flips the flag on the User and the local Identity', async () => {
    const user = await users.create({ email: 'verify@example.com', emailVerified: false });
    await identities.create({
      userId: user.id,
      provider: 'local',
      email: 'verify@example.com',
      passwordHash: 'h',
      emailVerified: false,
    });
    expect(await users.markEmailVerified(user.id)).toBe(true);
    expect(await identities.markEmailVerifiedByUserId(user.id)).toBe(true);

    expect((await users.findById(user.id))?.emailVerified).toBe(true);
    expect((await identities.findByEmailLower('local', 'verify@example.com'))?.emailVerified).toBe(
      true,
    );
    // Unknown user → no match (valid-but-nonexistent id; the real caller always passes a real userId).
    const ghostId = '0123456789abcdef01234567';
    expect(await users.markEmailVerified(ghostId)).toBe(false);
    expect(await identities.markEmailVerifiedByUserId(ghostId)).toBe(false);
  });
});

describe('PasswordResetTokenRepository (tenant-global, single-use)', () => {
  const NOW = new Date('2026-06-06T00:00:00.000Z');
  const LATER = new Date('2026-06-06T00:30:00.000Z'); // within the 1h window
  const EXPIRED_AT = new Date('2026-06-06T01:00:00.000Z');

  it('consumes a valid token exactly once (single-use CAS) and returns the owner', async () => {
    await resetTokens.create({ userId: 'u1', tokenHash: 'hash-a', expiresAt: EXPIRED_AT });
    const first = await resetTokens.consumeIfValid('hash-a', LATER);
    expect(first).toEqual({ userId: 'u1' });
    // Replaying the now-used token fails.
    expect(await resetTokens.consumeIfValid('hash-a', LATER)).toBeNull();
  });

  it('rejects an expired token', async () => {
    await resetTokens.create({ userId: 'u1', tokenHash: 'hash-b', expiresAt: NOW });
    // now (LATER) is past expiry → null, and the token is left unused (not consumed).
    expect(await resetTokens.consumeIfValid('hash-b', LATER)).toBeNull();
  });

  it('rejects an unknown token', async () => {
    expect(await resetTokens.consumeIfValid('does-not-exist', NOW)).toBeNull();
  });

  it('deleteByUserId invalidates a user’s outstanding tokens', async () => {
    await resetTokens.create({ userId: 'u1', tokenHash: 'hash-c', expiresAt: EXPIRED_AT });
    await resetTokens.deleteByUserId('u1');
    expect(await resetTokens.consumeIfValid('hash-c', LATER)).toBeNull();
  });
});

describe('EmailVerificationTokenRepository (tenant-global, single-use)', () => {
  const NOW = new Date('2026-06-06T00:00:00.000Z');
  const LATER = new Date('2026-06-06T06:00:00.000Z'); // within the 24h window
  const EXPIRES_AT = new Date('2026-06-07T00:00:00.000Z');

  it('consumes a valid token exactly once and returns the owner', async () => {
    await verifyTokens.create({ userId: 'u1', tokenHash: 'v-a', expiresAt: EXPIRES_AT });
    expect(await verifyTokens.consumeIfValid('v-a', LATER)).toEqual({ userId: 'u1' });
    expect(await verifyTokens.consumeIfValid('v-a', LATER)).toBeNull(); // single-use
  });

  it('rejects an expired token and an unknown token', async () => {
    await verifyTokens.create({ userId: 'u1', tokenHash: 'v-b', expiresAt: NOW });
    expect(await verifyTokens.consumeIfValid('v-b', LATER)).toBeNull(); // expired
    expect(await verifyTokens.consumeIfValid('missing', NOW)).toBeNull(); // unknown
  });

  it('deleteByUserId invalidates outstanding tokens', async () => {
    await verifyTokens.create({ userId: 'u1', tokenHash: 'v-c', expiresAt: EXPIRES_AT });
    await verifyTokens.deleteByUserId('u1');
    expect(await verifyTokens.consumeIfValid('v-c', LATER)).toBeNull();
  });
});

describe('tenant-scoped Membership (guarded)', () => {
  it('refuses to create a membership with no tenant context', async () => {
    await expect(memberships.create({ userId: 'u1', roles: [] })).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });

  it('resolves only the membership for the requested tenant', async () => {
    await runInTenantContext(ctx('t1'), () =>
      memberships.create({ userId: 'u1', roles: [{ role: 'owner', locationScope: 'ALL' }] }),
    );
    await runInTenantContext(ctx('t2'), () =>
      memberships.create({ userId: 'u1', roles: [{ role: 'member', locationScope: 'ALL' }] }),
    );

    const inT1 = await memberships.resolveForRequest('t1', 'u1');
    const inT2 = await memberships.resolveForRequest('t2', 'u1');
    const inT3 = await memberships.resolveForRequest('t3', 'u1');

    expect(inT1?.roles[0]?.role).toBe('owner');
    expect(inT2?.roles[0]?.role).toBe('member');
    expect(inT3).toBeNull();
  });
});
