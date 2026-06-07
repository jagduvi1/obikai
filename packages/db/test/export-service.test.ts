/**
 * Data-export assembly tests (GDPR Art. 15/20, audit H7) against an in-memory MongoDB. Verifies the
 * bundle gathers the subject's member-keyed PII via the ROPA registry AND the tenant-global identity
 * (login account + sessions), with secrets excluded.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionModel, UserModel } from '../src/auth.js';
import { buildExportBundle } from '../src/export-service.js';
import { MemberModel } from '../src/member.js';
import { buildRopaRegistry } from '../src/ropa.js';
import { BookingModel } from '../src/scheduling.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'owner', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const registry = buildRopaRegistry();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  for (const c of ['members', 'bookings', 'users', 'sessions']) {
    await mongoose.connection.collection(c).deleteMany({});
  }
});

describe('buildExportBundle', () => {
  it('gathers member-keyed PII + tenant-global identity into one bundle', async () => {
    const user = await UserModel.create({
      email: 'aiko@example.com',
      emailLower: 'aiko@example.com',
    });
    const userId = user._id.toString();
    const { memberId } = await runInTenantContext(ctx('t1'), async () => {
      const m = await MemberModel.create({
        firstName: 'Aiko',
        lastName: 'Tanaka',
        status: 'active',
        userId,
      });
      const id = m._id.toString();
      await BookingModel.create({
        occurrenceId: 'occ1',
        memberId: id,
        status: 'booked',
        bookedAt: 'x',
      });
      return { memberId: id };
    });
    await SessionModel.create({
      userId,
      family: 'f1',
      refreshTokenHash: 'secret-hash',
      expiresAt: new Date('2026-12-01'),
      lastUsedAt: new Date('2026-06-06'),
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });

    const bundle = await runInTenantContext(ctx('t1'), () =>
      buildExportBundle(registry, { tenantId: 't1', memberId, userId, now: 1_700_000_000_000 }),
    );

    const byModel = new Map(bundle.sections.map((s) => [s.model, s]));
    expect(byModel.get('member')?.records[0]).toMatchObject({ firstName: 'Aiko', email: null });
    // Member's email lives on the Member row only if set; the ACCOUNT email comes from the user section.
    expect(byModel.get('booking')?.records[0]).toMatchObject({
      occurrenceId: 'occ1',
      status: 'booked',
    });
    expect(byModel.get('user')?.records[0]).toMatchObject({ email: 'aiko@example.com' });
    expect(byModel.get('session')?.records[0]).toMatchObject({
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
    });
    // Secrets are never exported.
    expect(JSON.stringify(bundle)).not.toContain('secret-hash');
    expect(bundle.schemaVersion).toBe('obikai-export-v1');
    expect(bundle.subjectId).toBe(memberId);
  });

  it('omits empty sections and still includes identity when the member has no other data', async () => {
    const user = await UserModel.create({ email: 'b@example.com', emailLower: 'b@example.com' });
    const userId = user._id.toString();
    const memberId = await runInTenantContext(ctx('t1'), async () => {
      const m = await MemberModel.create({ firstName: 'B', lastName: 'B', status: 'lead', userId });
      return m._id.toString();
    });
    const bundle = await runInTenantContext(ctx('t1'), () =>
      buildExportBundle(registry, { tenantId: 't1', memberId, userId, now: 1 }),
    );
    const models = bundle.sections.map((s) => s.model);
    expect(models).toContain('member');
    expect(models).toContain('user');
    expect(models).not.toContain('booking'); // no bookings → section omitted
  });
});
