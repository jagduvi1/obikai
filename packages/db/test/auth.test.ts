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
  IdentityModel,
  IdentityRepository,
  MembershipModel,
  MembershipRepository,
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
