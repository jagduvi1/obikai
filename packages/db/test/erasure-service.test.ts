/**
 * Right-to-erasure tests (GDPR Art. 17, audit H4/H6) against an in-memory MongoDB. This is the most
 * safety-critical path in the product: it asserts that after erasure NO direct PII for the subject
 * survives in any collection — the member root is anonymized, footprint rows are gone, waiver blobs are
 * deleted, retained rows have their free-text scrubbed, and the account can no longer authenticate.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AttendanceModel } from '../src/attendance.js';
import { IdentityModel, MembershipModel, SessionModel, UserModel } from '../src/auth.js';
import { ConsentModel } from '../src/consent.js';
import { eraseMemberSubject } from '../src/erasure-service.js';
import { GuardianshipModel } from '../src/guardianship.js';
import { HouseholdModel } from '../src/household.js';
import { MemberModel } from '../src/member.js';
import { MessageLogModel } from '../src/message-log.js';
import { GradingResultModel } from '../src/rank.js';
import { BookingModel } from '../src/scheduling.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';
import { WaiverSignatureModel } from '../src/waiver.js';

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

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  for (const c of [
    'members',
    'bookings',
    'attendances',
    'waiversignatures',
    'gradingresults',
    'users',
    'identities',
    'sessions',
    'memberships',
    'consents',
    'messagelogs',
    'guardianships',
    'households',
  ]) {
    await mongoose.connection.collection(c).deleteMany({});
  }
});

async function seed() {
  const user = await UserModel.create({
    email: 'aiko@example.com',
    emailLower: 'aiko@example.com',
  });
  const userId = user._id.toString();
  await IdentityModel.create({
    userId,
    provider: 'local',
    email: 'aiko@example.com',
    emailLower: 'aiko@example.com',
    passwordHash: 'hash',
  });
  await SessionModel.create({
    userId,
    family: 'f1',
    refreshTokenHash: 'rt',
    expiresAt: new Date('2026-12-01'),
    lastUsedAt: new Date('2026-06-06'),
  });
  return runInTenantContext(ctx('t1'), async () => {
    const m = await MemberModel.create({
      firstName: 'Aiko',
      lastName: 'Tanaka',
      email: 'aiko@example.com',
      emailLower: 'aiko@example.com',
      phone: '+46700000000',
      dateOfBirth: '2010-01-01',
      status: 'active',
      userId,
      emergencyContact: { name: 'Parent', phone: '+46700000001', relation: 'mother' },
      notes: 'a private note',
    });
    const memberId = m._id.toString();
    await MembershipModel.create({ userId, memberId, roles: [], status: 'active' });
    const iso = '2026-06-06T00:00:00.000Z';
    await BookingModel.create({ occurrenceId: 'occ1', memberId, status: 'booked', bookedAt: iso });
    await AttendanceModel.create({ memberId, occurredAt: iso, method: 'instructor' });
    await WaiverSignatureModel.create({
      templateId: 'tpl1',
      templateVersion: 1,
      memberId,
      signedByName: 'Aiko Tanaka',
      isGuardian: false,
      signedAt: iso,
      ip: '203.0.113.5',
      documentStorageKey: 'tenants/t1/waivers/doc.pdf',
    });
    await GradingResultModel.create({
      gradingEventId: 'ge1',
      memberId,
      stepId: 'step1',
      passed: true,
      recordedByUserId: 'u-staff',
      recordedAt: iso,
      notes: 'Aiko did great — mentions her name',
    });
    // Consent record (keyed by the account userId) carrying Art. 7 evidence PII.
    await ConsentModel.create({
      subjectId: userId,
      purpose: 'marketing-email',
      lawfulBasis: 'consent',
      status: 'granted',
      policyVersion: '2026-06-01',
      grantedAt: new Date(iso),
      withdrawnAt: null,
      source: 'self-service',
      evidence: { ip: '198.51.100.9', userAgent: 'AikoBrowser/1.0' },
    });
    return { memberId, userId };
  });
}

describe('eraseMemberSubject', () => {
  it('removes/anonymizes ALL direct PII for the subject across collections', async () => {
    const { memberId, userId } = await seed();
    const deletedKeys: string[] = [];

    const result = await runInTenantContext(ctx('t1'), () =>
      eraseMemberSubject({
        tenantId: 't1',
        memberId,
        userId,
        storageDelete: async (k) => {
          deletedKeys.push(k);
        },
        now: 1_700_000_000_000,
      }),
    );

    // Footprint hard-deleted.
    expect(await mongoose.connection.collection('bookings').countDocuments({})).toBe(0);
    expect(await mongoose.connection.collection('attendances').countDocuments({})).toBe(0);
    expect(await mongoose.connection.collection('memberships').countDocuments({})).toBe(0);

    // Member root anonymized — no direct PII, and the unique-email index is released.
    const member = await mongoose.connection.collection('members').findOne({});
    expect(member?.firstName).toBe('[erased]');
    expect(member?.email).toBeNull();
    expect(member?.emailLower).toBeNull();
    expect(member?.phone).toBeNull();
    expect(member?.dateOfBirth).toBeNull();
    expect(member?.emergencyContact).toBeNull();
    expect(member?.notes).toBeNull();

    // Waiver: blob deleted from storage; denormalized columns anonymized.
    expect(deletedKeys).toEqual(['tenants/t1/waivers/doc.pdf']);
    const waiver = await mongoose.connection.collection('waiversignatures').findOne({});
    expect(waiver?.signedByName).toBe('[erased]');
    expect(waiver?.ip).toBeNull();
    expect(waiver?.documentStorageKey).toBeNull();

    // Retained-but-scrubbed: the grading result survives (rank history) with its free-text removed.
    const grading = await mongoose.connection.collection('gradingresults').findOne({});
    expect(grading).not.toBeNull();
    expect(grading?.notes).toBeNull();

    // Account: email anonymized, credentials + sessions gone (can never log in again).
    const account = await mongoose.connection.collection('users').findOne({});
    expect(account?.email).not.toBe('aiko@example.com');
    expect(String(account?.email)).toContain('erased');
    expect(await mongoose.connection.collection('identities').countDocuments({})).toBe(0);
    expect(await mongoose.connection.collection('sessions').countDocuments({})).toBe(0);

    // Consent records (Art. 7 evidence PII) hard-deleted.
    expect(await mongoose.connection.collection('consents').countDocuments({})).toBe(0);
    expect(result.perModel.find((p) => p.model === 'consent')?.strategy).toBe('hard_delete');

    // No raw PII (name/email/phone + consent evidence) survives ANYWHERE in the erased collections.
    const dump = JSON.stringify(
      await Promise.all(
        ['members', 'waiversignatures', 'gradingresults', 'users', 'consents'].map((c) =>
          mongoose.connection.collection(c).find({}).toArray(),
        ),
      ),
    );
    for (const pii of [
      'Aiko',
      'Tanaka',
      'aiko@example.com',
      '+46700000000',
      '2010-01-01',
      '198.51.100.9',
      'AikoBrowser/1.0',
    ]) {
      expect(dump).not.toContain(pii);
    }

    expect(result.subjectId).toBe(memberId);
    expect(result.perModel.find((p) => p.model === 'member')?.strategy).toBe('anonymize');
  });

  it('erases message history, guardianship edges, and household payer linkage', async () => {
    const { memberId, userId } = await seed();
    await runInTenantContext(ctx('t1'), async () => {
      await MessageLogModel.create({
        broadcastId: 'b1',
        memberId,
        channel: 'email',
        category: 'marketing',
        subject: 'Summer camp — Aiko',
        status: 'sent',
      });
      // The subject as a minor (a guardian links to them) AND as a guardian (links to another minor).
      await GuardianshipModel.create({ guardianUserId: 'guardian-u', minorMemberId: memberId });
      await GuardianshipModel.create({ guardianUserId: userId, minorMemberId: 'other-minor' });
      await HouseholdModel.create({ name: 'Tanaka', payerMemberId: memberId, payerUserId: userId });
    });

    await runInTenantContext(ctx('t1'), () =>
      eraseMemberSubject({ tenantId: 't1', memberId, userId, storageDelete: async () => {}, now: 1 }),
    );

    expect(await mongoose.connection.collection('messagelogs').countDocuments({})).toBe(0);
    // Both the minor-side and guardian-side edges for the subject are gone.
    expect(await mongoose.connection.collection('guardianships').countDocuments({})).toBe(0);
    // The household survives (other members may remain) but the subject's payer links are dropped.
    const hh = await mongoose.connection.collection('households').findOne({});
    expect(hh?.name).toBe('Tanaka');
    expect(hh?.payerMemberId).toBeNull();
    expect(hh?.payerUserId).toBeNull();
  });

  it('keeps the shared account for a cross-training student with a membership in another tenant', async () => {
    const { memberId, userId } = await seed();
    // The same login also trains at tenant t2 (raw insert: a different tenant's membership).
    await mongoose.connection.collection('memberships').insertOne({
      tenantId: 't2',
      userId,
      memberId: 'm-t2',
      roles: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runInTenantContext(ctx('t1'), () =>
      eraseMemberSubject({ tenantId: 't1', memberId, userId, storageDelete: async () => {}, now: 1 }),
    );

    // The t1 member is still anonymized and its footprint gone…
    const member = await mongoose.connection.collection('members').findOne({});
    expect(member?.firstName).toBe('[erased]');
    expect(await mongoose.connection.collection('memberships').countDocuments({ tenantId: 't1' })).toBe(0);
    // …but the SHARED login survives so t2 isn't locked out: email intact, credentials + sessions kept.
    const account = await mongoose.connection.collection('users').findOne({});
    expect(account?.email).toBe('aiko@example.com');
    expect(await mongoose.connection.collection('identities').countDocuments({})).toBe(1);
    expect(await mongoose.connection.collection('sessions').countDocuments({})).toBe(1);
    expect(result.perModel.find((p) => p.model === 'user')?.strategy).toBe('retain');
  });

  it('erases a member with no linked account (skips the identity step)', async () => {
    const memberId = await runInTenantContext(ctx('t1'), async () => {
      const m = await MemberModel.create({ firstName: 'Solo', lastName: 'X', status: 'active' });
      return m._id.toString();
    });
    const result = await runInTenantContext(ctx('t1'), () =>
      eraseMemberSubject({
        tenantId: 't1',
        memberId,
        userId: null,
        storageDelete: async () => {},
        now: 1,
      }),
    );
    const member = await mongoose.connection.collection('members').findOne({});
    expect(member?.firstName).toBe('[erased]');
    expect(result.perModel.some((p) => p.model === 'user')).toBe(false); // no account step
  });
});
