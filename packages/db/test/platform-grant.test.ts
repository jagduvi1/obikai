/**
 * Platform-grant persistence tests (ADR-0021). Verifies the collection is TENANT-GLOBAL (works with
 * NO tenant context — the deliberate guard exemption, like User/Tenant), that grants are one-per-user
 * and idempotent, and that resolution/revocation behave. Requires a downloaded mongodb-memory-server.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformGrantModel, PlatformGrantRepository } from '../src/platform-grant.js';

let mongod: MongoMemoryServer;
const repo = new PlatformGrantRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await PlatformGrantModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('platformgrants').deleteMany({});
});

describe('guard exemption is deliberate (ADR-0004/0021)', () => {
  it('the PlatformGrant schema has NO tenantId path (it is tenant-global)', () => {
    expect(PlatformGrantModel.schema.path('tenantId')).toBeUndefined();
  });
});

describe('grants (tenant-global; any context)', () => {
  it('grants and resolves a platform role with NO tenant context', async () => {
    const granted = await repo.grant({ userId: 'u1', role: 'platform_admin' });
    expect(granted.userId).toBe('u1');
    expect(granted.role).toBe('platform_admin');
    expect((await repo.findByUserId('u1'))?.role).toBe('platform_admin');
  });

  it('findByUserId returns null for a user with no grant', async () => {
    expect(await repo.findByUserId('nobody')).toBeNull();
  });

  it('is idempotent per user (one grant; upsert updates the role in place)', async () => {
    await repo.grant({ userId: 'u1', role: 'platform_admin' });
    await repo.grant({ userId: 'u1', role: 'platform_admin' });
    expect(await repo.list()).toHaveLength(1);
    const count = await mongoose.connection
      .collection('platformgrants')
      .countDocuments({ userId: 'u1' });
    expect(count).toBe(1);
  });

  it('revoke removes platform access', async () => {
    await repo.grant({ userId: 'u1', role: 'platform_admin' });
    await repo.revoke('u1');
    expect(await repo.findByUserId('u1')).toBeNull();
    expect(await repo.list()).toHaveLength(0);
  });
});
