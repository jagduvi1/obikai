/**
 * Consent-record tests (ADR-0007/0026, GDPR Art. 6(1)(a)/7) against an in-memory MongoDB. Verifies
 * the repository implements the @obikai/gdpr port, is APPEND-ONLY (withdrawal never overwrites the
 * grant — Art. 7(1) demonstrability survives), tracks current state per purpose, and is per-tenant.
 */
import type { ConsentRecord } from '@obikai/gdpr';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ConsentModel, ConsentRepository } from '../src/consent.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'member', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const consents = new ConsentRepository();

const grant = (
  tenantId: string,
  subjectId: string,
  purpose: string,
  over: Partial<ConsentRecord> = {},
): Promise<void> =>
  runInTenantContext(ctx(tenantId), () =>
    consents.record({
      tenantId: tenantId as ConsentRecord['tenantId'],
      subjectId: subjectId as ConsentRecord['subjectId'],
      purpose,
      lawfulBasis: 'consent',
      status: 'granted',
      policyVersion: '2026-06-01',
      grantedAt: new Date('2026-06-06T10:00:00.000Z'),
      withdrawnAt: null,
      source: 'web-signup-form',
      evidence: { ip: '203.0.113.5', note: 'checkbox: marketing email' },
      ...over,
    }),
  );

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await ConsentModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('consents').deleteMany({});
});

describe('ConsentRepository', () => {
  it('records a grant and lists it for the subject', async () => {
    await grant('t1', 'u-sub', 'marketing-email');
    const list = await runInTenantContext(ctx('t1'), () =>
      consents.listForSubject('t1' as never, 'u-sub' as never),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      purpose: 'marketing-email',
      status: 'granted',
      lawfulBasis: 'consent',
    });
    expect(list[0]?.withdrawnAt).toBeNull();
  });

  it('withdraws by APPENDING a withdrawn record — the grant evidence is preserved (Art. 7(1))', async () => {
    await grant('t1', 'u-sub', 'marketing-email');
    const withdrawn = await runInTenantContext(ctx('t1'), () =>
      consents.withdraw(
        't1' as never,
        'u-sub' as never,
        'marketing-email',
        new Date('2026-07-01T00:00:00.000Z'),
      ),
    );
    expect(withdrawn?.status).toBe('withdrawn');
    expect(withdrawn?.withdrawnAt).toEqual(new Date('2026-07-01T00:00:00.000Z'));
    // The withdrawal carries the ORIGINAL grant evidence — demonstrability survives.
    expect(withdrawn?.grantedAt).toEqual(new Date('2026-06-06T10:00:00.000Z'));
    expect(withdrawn?.evidence?.note).toBe('checkbox: marketing email');

    const list = await runInTenantContext(ctx('t1'), () =>
      consents.listForSubject('t1' as never, 'u-sub' as never),
    );
    // Append-only: BOTH the grant and the withdrawal rows survive; current state = the last one.
    expect(list.map((c) => c.status)).toEqual(['granted', 'withdrawn']);
  });

  it('currentStatus reflects the latest record (null → granted → withdrawn)', async () => {
    await runInTenantContext(ctx('t1'), async () => {
      // Never recorded → null (the marketing gate treats this as "no consent").
      expect(
        await consents.currentStatus('t1' as never, 'u-sub' as never, 'marketing_email'),
      ).toBeNull();
    });
    await grant('t1', 'u-sub', 'marketing_email');
    await runInTenantContext(ctx('t1'), async () => {
      expect(await consents.currentStatus('t1' as never, 'u-sub' as never, 'marketing_email')).toBe(
        'granted',
      );
    });
    await runInTenantContext(ctx('t1'), () =>
      consents.withdraw('t1' as never, 'u-sub' as never, 'marketing_email', new Date()),
    );
    await runInTenantContext(ctx('t1'), async () => {
      expect(await consents.currentStatus('t1' as never, 'u-sub' as never, 'marketing_email')).toBe(
        'withdrawn',
      );
    });
  });

  it('returns null when withdrawing a purpose with no active grant', async () => {
    const none = await runInTenantContext(ctx('t1'), () =>
      consents.withdraw('t1' as never, 'u-sub' as never, 'never-granted', new Date()),
    );
    expect(none).toBeNull();
    // And withdrawing an already-withdrawn purpose is also a no-op.
    await grant('t1', 'u-sub', 'photos');
    await runInTenantContext(ctx('t1'), () =>
      consents.withdraw(
        't1' as never,
        'u-sub' as never,
        'photos',
        new Date('2026-07-01T00:00:00.000Z'),
      ),
    );
    const again = await runInTenantContext(ctx('t1'), () =>
      consents.withdraw(
        't1' as never,
        'u-sub' as never,
        'photos',
        new Date('2026-08-01T00:00:00.000Z'),
      ),
    );
    expect(again).toBeNull();
  });

  it('keeps consent records strictly per tenant', async () => {
    await grant('t1', 'u-sub', 'marketing-email');
    const t2 = await runInTenantContext(ctx('t2'), () =>
      consents.listForSubject('t2' as never, 'u-sub' as never),
    );
    expect(t2).toHaveLength(0); // t1's consent is invisible to t2
  });

  it('supports re-granting after withdrawal (a fresh granted record becomes current)', async () => {
    await grant('t1', 'u-sub', 'marketing-email');
    await runInTenantContext(ctx('t1'), () =>
      consents.withdraw(
        't1' as never,
        'u-sub' as never,
        'marketing-email',
        new Date('2026-07-01T00:00:00.000Z'),
      ),
    );
    await grant('t1', 'u-sub', 'marketing-email', {
      grantedAt: new Date('2026-08-01T00:00:00.000Z'),
      policyVersion: '2026-08-01',
    });
    const list = await runInTenantContext(ctx('t1'), () =>
      consents.listForSubject('t1' as never, 'u-sub' as never),
    );
    expect(list.map((c) => c.status)).toEqual(['granted', 'withdrawn', 'granted']);
    expect(list.at(-1)?.policyVersion).toBe('2026-08-01'); // current state is the new grant
  });
});
