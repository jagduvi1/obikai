/**
 * Per-tenant GDPR audit-log tests (ADR-0007/0026) against an in-memory MongoDB. Verifies the chain is
 * built on the @obikai/gdpr primitives, is tamper-evident, is strictly per-tenant, stays linear under
 * concurrent appends, and that optional fields (diff/ip) hash canonically whether present or absent.
 */
import { verifyChain } from '@obikai/gdpr';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLogModel, AuditLogRepository } from '../src/audit-log.js';
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
// Deterministic, strictly-increasing clock so ts never collides (proves order rests on seq, not ts).
let tick = 1_700_000_000_000;
const clock = () => ++tick;
const audit = new AuditLogRepository(AuditLogModel, clock);

const append = (tenantId: string, action: string, targetId: string, extra = {}) =>
  runInTenantContext(ctx(tenantId), () =>
    audit.append({
      actorId: 'u1' as never,
      actorType: 'user',
      action,
      targetType: 'member',
      targetId,
      ...extra,
    }),
  );

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await AuditLogModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('auditlogs').deleteMany({});
});

describe('AuditLogRepository', () => {
  it('builds a verifiable hash chain (genesis prevHash null, each links to the prior)', async () => {
    const a = await append('t1', 'member.create', 'm1');
    const b = await append('t1', 'member.update', 'm1', { diff: { firstName: 'changed' } });
    const c = await append('t1', 'member.delete', 'm1', { ip: '203.0.113.7' });

    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);

    const chain = await runInTenantContext(ctx('t1'), () => audit.list());
    expect(chain.map((e) => e.action)).toEqual(['member.create', 'member.update', 'member.delete']);
    expect(verifyChain(chain)).toEqual({ valid: true });
    expect(await runInTenantContext(ctx('t1'), () => audit.verify())).toEqual({ valid: true });
  });

  it('detects tampering: editing a stored entry breaks the chain', async () => {
    await append('t1', 'member.create', 'm1');
    await append('t1', 'member.update', 'm1');
    // Tamper with the genesis entry's action directly via the raw driver (bypassing the repo).
    await mongoose.connection
      .collection('auditlogs')
      .updateOne({ seq: 0 }, { $set: { action: 'member.delete' } });

    const v = await runInTenantContext(ctx('t1'), () => audit.verify());
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.index).toBe(0);
  });

  it('keeps chains strictly per tenant (each tenant has its own genesis)', async () => {
    await append('t1', 'member.create', 'm1');
    const t2genesis = await append('t2', 'member.create', 'mX');
    await append('t1', 'member.update', 'm1');

    expect(t2genesis.prevHash).toBeNull(); // t2 starts its own chain, not chained onto t1
    const t1 = await runInTenantContext(ctx('t1'), () => audit.list());
    const t2 = await runInTenantContext(ctx('t2'), () => audit.list());
    expect(t1).toHaveLength(2);
    expect(t2).toHaveLength(1);
    expect(verifyChain(t1)).toEqual({ valid: true });
    expect(verifyChain(t2)).toEqual({ valid: true });
    // No cross-tenant leakage: t2's entry never appears in t1's chain.
    expect(t1.some((e) => e.targetId === 'mX')).toBe(false);
  });

  it('stays linear under concurrent appends (no fork, no lost events)', async () => {
    const N = 8; // safely under MAX_APPEND_ATTEMPTS so every contended append resolves
    await Promise.all(Array.from({ length: N }, (_, i) => append('t1', 'member.update', `m${i}`)));
    const chain = await runInTenantContext(ctx('t1'), () => audit.list());
    expect(chain).toHaveLength(N); // no event dropped under contention
    expect(verifyChain(chain)).toEqual({ valid: true }); // single linear chain, no fork
  });

  it('hashes canonically with diff/ip absent vs present', async () => {
    await append('t1', 'a', 'm1'); // no diff, no ip
    await append('t1', 'b', 'm1', { diff: { x: 1 }, ip: '198.51.100.1' });
    const chain = await runInTenantContext(ctx('t1'), () => audit.list());
    // verifyChain recomputes each hash from the round-tripped doc; passing proves absent != null.
    expect(verifyChain(chain)).toEqual({ valid: true });
  });
});
