/**
 * Tenant registry tests (ADR-0017). Verifies the registry is TENANT-GLOBAL (single-slug ops work
 * with NO tenant context — the deliberate guard exemption), that `ensureRegistered` is idempotent
 * and never mutates an existing tenant, and that ENUMERATION refuses to run outside an explicit
 * `runAsPlatform(...)` marker (cross-tenant reads are never implicit). Requires a downloaded
 * mongodb-memory-server binary.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformContextError } from '../src/errors.js';
import { runAsPlatform, runInTenantContext } from '../src/tenant-context.js';
import { TenantModel, TenantRegistryRepository } from '../src/tenant.js';

let mongod: MongoMemoryServer;
const tenants = new TenantRegistryRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await TenantModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('tenants').deleteMany({});
});

describe('guard exemption is deliberate (ADR-0004/0017)', () => {
  it('the Tenant schema has NO tenantId path (it is the registry OF tenants)', () => {
    expect(TenantModel.schema.path('tenantId')).toBeUndefined();
  });
});

describe('single-slug operations (tenant-global; any context)', () => {
  it('creates and reads a tenant with NO context; slug === id', async () => {
    const created = await tenants.create({ slug: 'aikido-sthlm', name: 'Aikido Stockholm' });
    expect(created.slug).toBe('aikido-sthlm');
    expect(created.id).toBe('aikido-sthlm');
    expect(created.status).toBe('active');

    const found = await tenants.findBySlug('aikido-sthlm');
    expect(found?.name).toBe('Aikido Stockholm');
  });

  it('findBySlug returns null for an unknown slug', async () => {
    expect(await tenants.findBySlug('nope')).toBeNull();
  });

  it('ensureRegistered is idempotent and never mutates an existing tenant', async () => {
    const first = await tenants.ensureRegistered({ slug: 'dojo', name: 'Original Name' });
    expect(first.name).toBe('Original Name');

    // Re-running with a different name must NOT overwrite (re-running create-owner is a no-op).
    const second = await tenants.ensureRegistered({ slug: 'dojo', name: 'Different Name' });
    expect(second.name).toBe('Original Name');

    await runAsPlatform(async () => {
      expect(await tenants.list()).toHaveLength(1);
    });
  });

  it('works inside a tenant context too (registry is not guarded)', async () => {
    await runInTenantContext(
      {
        tenantId: 'dojo',
        userId: null,
        sessionId: null,
        roles: [],
        memberId: null,
        requestId: 'r',
        tenancy: 'multi',
      },
      () => tenants.ensureRegistered({ slug: 'dojo', name: 'Dojo' }),
    );
    expect(await tenants.findBySlug('dojo')).not.toBeNull();
  });

  it('updateStatus flips lifecycle state', async () => {
    await tenants.create({ slug: 'dojo', name: 'Dojo' });
    const suspended = await tenants.updateStatus('dojo', 'suspended');
    expect(suspended?.status).toBe('suspended');
    expect((await tenants.findBySlug('dojo'))?.status).toBe('suspended');
  });

  it('rejects a duplicate slug via the primary key', async () => {
    await tenants.create({ slug: 'dojo', name: 'Dojo' });
    await expect(tenants.create({ slug: 'dojo', name: 'Dup' })).rejects.toBeTruthy();
  });
});

describe('enumeration requires the explicit platform marker (ADR-0004)', () => {
  beforeEach(async () => {
    await tenants.create({ slug: 'a', name: 'A' });
    await tenants.create({ slug: 'b', name: 'B', status: 'suspended' });
    await tenants.create({ slug: 'c', name: 'C' });
  });

  it('list() throws PlatformContextError with no context', async () => {
    await expect(tenants.list()).rejects.toBeInstanceOf(PlatformContextError);
  });

  it('list() throws PlatformContextError inside a tenant context', async () => {
    await runInTenantContext(
      {
        tenantId: 'a',
        userId: null,
        sessionId: null,
        roles: [],
        memberId: null,
        requestId: 'r',
        tenancy: 'multi',
      },
      async () => {
        await expect(tenants.list()).rejects.toBeInstanceOf(PlatformContextError);
      },
    );
  });

  it('list() returns all tenants, slug-sorted, under runAsPlatform', async () => {
    await runAsPlatform(async () => {
      const all = await tenants.list();
      expect(all.map((t) => t.slug)).toEqual(['a', 'b', 'c']);
    });
  });

  it('listActive() returns only active tenants under runAsPlatform', async () => {
    await runAsPlatform(async () => {
      const active = await tenants.listActive();
      expect(active.map((t) => t.slug)).toEqual(['a', 'c']);
    });
  });
});
