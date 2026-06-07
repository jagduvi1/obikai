/**
 * Platform audit-log tests (ADR-0023). Verifies the log is TENANT-GLOBAL, append-only + hash-chained
 * (tamper-evident), that enumeration requires the platform marker, and that a forked append (same
 * predecessor) is rejected by the unique prevHash and retried. Requires mongodb-memory-server.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformContextError } from '../src/errors.js';
import {
  PlatformAuditModel,
  PlatformAuditRepository,
  verifyPlatformAuditChain,
} from '../src/platform-audit.js';
import { runAsPlatform } from '../src/tenant-context.js';

let mongod: MongoMemoryServer;
const repo = new PlatformAuditRepository();

const entry = (action: string, targetId: string) => ({
  actorUserId: 'admin-1',
  action,
  targetType: 'tenant',
  targetId,
  ip: '203.0.113.7',
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await PlatformAuditModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('platformaudits').deleteMany({});
});

describe('tenant-global, append-only (ADR-0004/0023)', () => {
  it('the schema has NO tenantId path (the platform log is not tenant-owned)', () => {
    expect(PlatformAuditModel.schema.path('tenantId')).toBeUndefined();
  });
});

describe('hash chain', () => {
  it('chains genesis → links and verifies', async () => {
    const a = await repo.append(entry('tenant.list', '*'));
    const b = await repo.append(entry('tenant.read', 'acme'));
    const c = await repo.append(entry('tenant.usage.read', 'acme'));

    expect(a.prevHash).toBeNull();
    expect(b.prevHash).toBe(a.hash);
    expect(c.prevHash).toBe(b.hash);

    const chain = await runAsPlatform(() => repo.list());
    expect(chain.map((e) => e.action)).toEqual(['tenant.list', 'tenant.read', 'tenant.usage.read']);
    expect(verifyPlatformAuditChain(chain).valid).toBe(true);
  });

  it('detects tampering: editing a recorded entry breaks verification', async () => {
    await repo.append(entry('tenant.read', 'acme'));
    await repo.append(entry('tenant.read', 'globex'));
    const chain = await runAsPlatform(() => repo.list());

    const tampered = chain.map((e, i) => (i === 0 ? { ...e, targetId: 'evilcorp' } : e));
    const result = verifyPlatformAuditChain(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.index).toBe(0);
  });

  it('detects a deleted/reordered entry', async () => {
    await repo.append(entry('a', '1'));
    await repo.append(entry('b', '2'));
    await repo.append(entry('c', '3'));
    const chain = await runAsPlatform(() => repo.list());
    // Drop the middle entry → the third's prevHash no longer links.
    const broken = [chain[0]!, chain[2]!];
    expect(verifyPlatformAuditChain(broken).valid).toBe(false);
  });
});

describe('order is clock-independent (monotonic seq, not ts/_id)', () => {
  it('preserves insertion order and verifies even when the clock runs BACKWARDS', async () => {
    // A backwards/non-monotonic wall clock (NTP step, VM migration) must not reorder the chain or
    // wedge appends — order is anchored by seq, not ts.
    let t = 2000;
    const skewRepo = new PlatformAuditRepository(PlatformAuditModel, () => t--);
    await skewRepo.append(entry('first', '1'));
    await skewRepo.append(entry('second', '2'));
    await skewRepo.append(entry('third', '3'));

    const chain = await runAsPlatform(() => skewRepo.list());
    expect(chain.map((e) => e.action)).toEqual(['first', 'second', 'third']);
    // ts is genuinely decreasing, proving order does NOT come from ts.
    expect(chain[0]!.ts).toBeGreaterThan(chain[2]!.ts);
    expect(verifyPlatformAuditChain(chain).valid).toBe(true);
  });
});

describe('known limitation: tail truncation', () => {
  it('a truncated PREFIX still verifies (backward hash chains cannot detect newest-entry deletion)', async () => {
    await repo.append(entry('a', '1'));
    await repo.append(entry('b', '2'));
    const chain = await runAsPlatform(() => repo.list());
    // Dropping the newest entry leaves a valid prefix — documented boundary (ADR-0023), needs an
    // external head anchor to detect; internal/middle deletion IS caught (tested above).
    expect(verifyPlatformAuditChain(chain.slice(0, 1)).valid).toBe(true);
  });
});

describe('enumeration requires the platform marker', () => {
  it('list() throws PlatformContextError without runAsPlatform', async () => {
    await repo.append(entry('tenant.list', '*'));
    await expect(repo.list()).rejects.toBeInstanceOf(PlatformContextError);
  });
});

describe('single global chain (unique prevHash blocks forks)', () => {
  it('only one genesis entry can exist', async () => {
    await repo.append(entry('first', '1'));
    // Force a second genesis (prevHash:null) directly — the unique index must reject it.
    await expect(
      mongoose.connection.collection('platformaudits').insertOne({
        ts: 1,
        actorUserId: null,
        action: 'forged-genesis',
        targetType: 'tenant',
        targetId: 'x',
        ip: null,
        prevHash: null,
        hash: 'deadbeef',
      }),
    ).rejects.toBeTruthy();
  });
});
