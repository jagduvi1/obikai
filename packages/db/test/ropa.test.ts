/**
 * ROPA registry tests (ADR-0007/0026, GDPR Art. 15/17/30) against an in-memory MongoDB. Verifies the
 * registry covers the expected PII models and that a member-keyed record can locate the subject's rows,
 * export the right fields, and (for anonymize-strategy models) strip PII — the contract export/erasure
 * rely on.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MemberModel } from '../src/member.js';
import { ROPA_REGISTERED_MODELS, buildRopaRegistry } from '../src/ropa.js';
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
  await mongoose.connection.collection('members').deleteMany({});
  await mongoose.connection.collection('bookings').deleteMany({});
});

describe('buildRopaRegistry', () => {
  it('registers exactly the documented set of PII models, each with purpose + lawful basis', () => {
    expect([...registry.models()].sort()).toEqual([...ROPA_REGISTERED_MODELS].sort());
    for (const rec of registry.list()) {
      expect(rec.purpose.length).toBeGreaterThan(0);
      expect(rec.lawfulBasis).toBeTruthy();
      expect(rec.role).toBe('controller');
    }
  });

  it('member record: finds the subject, exports PII, and anonymize strips it', async () => {
    const memberId = await runInTenantContext(ctx('t1'), async () => {
      const m = await MemberModel.create({
        firstName: 'Aiko',
        lastName: 'Tanaka',
        status: 'active',
      });
      return m._id.toString();
    });

    const rec = registry.get('member');
    expect(rec).toBeDefined();
    if (!rec) return;

    const rows = await runInTenantContext(ctx('t1'), () => rec.findBySubject('t1', memberId));
    expect(rows).toHaveLength(1);

    const exported = rec.toExport?.(rows[0]);
    expect(exported).toMatchObject({ firstName: 'Aiko', lastName: 'Tanaka', status: 'active' });

    const anon = rec.anonymize?.(rows[0]) as { firstName: string; email: unknown } | undefined;
    expect(anon?.firstName).toBe('[erased]');
    expect(anon?.email).toBeNull();
  });

  it('member-keyed record (booking): finds only the subject’s rows; empty for a stranger', async () => {
    const memberId = await runInTenantContext(ctx('t1'), async () => {
      const m = await MemberModel.create({ firstName: 'B', lastName: 'B', status: 'active' });
      const id = m._id.toString();
      await BookingModel.create({
        occurrenceId: 'occ1',
        memberId: id,
        status: 'booked',
        bookedAt: 'x',
      });
      return id;
    });

    const rec = registry.get('booking');
    if (!rec) throw new Error('booking record missing');
    const mine = await runInTenantContext(ctx('t1'), () => rec.findBySubject('t1', memberId));
    expect(mine).toHaveLength(1);
    expect(rec.toExport?.(mine[0])).toMatchObject({ occurrenceId: 'occ1', status: 'booked' });

    const none = await runInTenantContext(ctx('t1'), () => rec.findBySubject('t1', 'someone-else'));
    expect(none).toHaveLength(0);
  });

  it('declares an erasure strategy for every model; immutable/financial are retained', () => {
    const strat = (m: string) => registry.get(m)?.erasure;
    expect(strat('member')).toBe('anonymize');
    expect(strat('booking')).toBe('hard_delete');
    expect(strat('invoice')).toBe('retain'); // bookkeeping
    expect(strat('promotion')).toBe('retain'); // immutable history
    expect(strat('waiverSignature')).toBe('crypto_shred');
    // crypto_shred + denormalized PII columns → also carries an anonymize transform.
    expect(registry.get('waiverSignature')?.anonymize).toBeTypeOf('function');
    for (const m of ROPA_REGISTERED_MODELS) expect(strat(m)).toBeTruthy();
  });
});
