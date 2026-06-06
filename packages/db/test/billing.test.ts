/**
 * Billing repository tests (ADR-0013) against a real Mongoose connection backed by an in-memory
 * MongoDB. The §11 rigor focus: gapless, sequential, PER-TENANT invoice numbering under
 * concurrency, and the per-tenant uniqueness of issued invoice numbers. Requires a downloaded
 * `mongodb-memory-server` binary to run.
 */
import { money } from '@obikai/domain';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  InvoiceCounterModel,
  InvoiceCounterRepository,
  InvoiceModel,
  InvoiceRepository,
} from '../src/billing.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'staff', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const counters = new InvoiceCounterRepository();
const invoices = new InvoiceRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await InvoiceCounterModel.syncIndexes();
  await InvoiceModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('invoicecounters').deleteMany({});
  await mongoose.connection.collection('invoices').deleteMany({});
});

describe('InvoiceCounterRepository.allocateInvoiceNumber', () => {
  it('is gapless and sequential within a tenant (1,2,3 with no gaps)', async () => {
    const a = await counters.allocateInvoiceNumber('t1', 2026);
    const b = await counters.allocateInvoiceNumber('t1', 2026);
    const c = await counters.allocateInvoiceNumber('t1', 2026);
    expect([a, b, c]).toEqual(['OBK-2026-000001', 'OBK-2026-000002', 'OBK-2026-000003']);
  });

  it('keeps sequences independent PER TENANT (concurrent allocations never collide)', async () => {
    // Fire many allocations for two tenants concurrently and interleaved.
    const ops: Promise<{ tenant: string; number: string }>[] = [];
    for (let i = 0; i < 25; i++) {
      ops.push(
        counters.allocateInvoiceNumber('t1', 2026).then((number) => ({ tenant: 't1', number })),
      );
      ops.push(
        counters.allocateInvoiceNumber('t2', 2026).then((number) => ({ tenant: 't2', number })),
      );
    }
    const results = await Promise.all(ops);

    const t1 = results.filter((r) => r.tenant === 't1').map((r) => r.number);
    const t2 = results.filter((r) => r.tenant === 't2').map((r) => r.number);

    // Each tenant got exactly 25 DISTINCT numbers — no collisions across the concurrent runs.
    expect(new Set(t1).size).toBe(25);
    expect(new Set(t2).size).toBe(25);

    // And each tenant's set is the gapless 1..25 sequence (order of completion may vary).
    const expected = (tenant: number) =>
      Array.from({ length: 25 }, (_, i) => `OBK-2026-${String(i + 1).padStart(6, '0')}`);
    expect([...t1].sort()).toEqual(expected(1));
    expect([...t2].sort()).toEqual(expected(2));
  });
});

describe('Invoice {tenantId, number} uniqueness', () => {
  const draftFields = (memberId: string) => ({
    memberId,
    currency: 'SEK' as const,
    lines: [],
    subtotal: money(0, 'SEK'),
    vatTotal: money(0, 'SEK'),
    total: money(0, 'SEK'),
  });

  it('allows many null-numbered drafts but rejects a duplicate number within a tenant', async () => {
    // Two drafts (number: null) in the same tenant must coexist (partial/sparse index).
    await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m1')));
    const second = await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m2')));

    // Issue the second with an allocated number.
    await runInTenantContext(ctx('t1'), () =>
      invoices.update(second.id, { number: 'OBK-2026-000001', status: 'open' }),
    );

    // A different invoice taking the SAME number in the SAME tenant is rejected by the unique index.
    const third = await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m3')));
    await expect(
      runInTenantContext(ctx('t1'), () =>
        invoices.update(third.id, { number: 'OBK-2026-000001', status: 'open' }),
      ),
    ).rejects.toThrow();
  });

  it('allows the same number across DIFFERENT tenants', async () => {
    const a = await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m1')));
    const b = await runInTenantContext(ctx('t2'), () => invoices.create(draftFields('m1')));
    await runInTenantContext(ctx('t1'), () =>
      invoices.update(a.id, { number: 'OBK-2026-000001', status: 'open' }),
    );
    const issuedB = await runInTenantContext(ctx('t2'), () =>
      invoices.update(b.id, { number: 'OBK-2026-000001', status: 'open' }),
    );
    expect(issuedB?.number).toBe('OBK-2026-000001');
  });
});
