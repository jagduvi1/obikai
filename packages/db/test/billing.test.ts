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
  DuplicateInvoicePeriodError,
  EnrollmentModel,
  EnrollmentRepository,
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

const enrollments = new EnrollmentRepository();

beforeAll(async () => {
  await EnrollmentModel.syncIndexes();
}, 120_000);

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('invoicecounters').deleteMany({});
  await mongoose.connection.collection('invoices').deleteMany({});
  await mongoose.connection.collection('enrollments').deleteMany({});
});

describe('InvoiceCounterRepository.allocateInvoiceNumber', () => {
  it('is gapless and sequential within a tenant (1,2,3 with no gaps)', async () => {
    const a = await counters.allocateInvoiceNumber('t1', 2026);
    const b = await counters.allocateInvoiceNumber('t1', 2026);
    const c = await counters.allocateInvoiceNumber('t1', 2026);
    expect([a, b, c]).toEqual(['OBK-2026-000001', 'OBK-2026-000002', 'OBK-2026-000003']);
  });

  it('resets the sequence per year and labels the issue year (review fix)', async () => {
    expect(await counters.allocateInvoiceNumber('t1', 2026)).toBe('OBK-2026-000001');
    expect(await counters.allocateInvoiceNumber('t1', 2026)).toBe('OBK-2026-000002');
    // New year → sequence restarts at 1 and the printed year tracks the issue year.
    expect(await counters.allocateInvoiceNumber('t1', 2027)).toBe('OBK-2027-000001');
    expect(await counters.allocateInvoiceNumber('t1', 2027)).toBe('OBK-2027-000002');
    // Back to 2026 continues that year's series (independent counters).
    expect(await counters.allocateInvoiceNumber('t1', 2026)).toBe('OBK-2026-000003');
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

    // Assign a number to the second (the ONLY way a number is set — assignNumber, once).
    await runInTenantContext(ctx('t1'), () => invoices.assignNumber(second.id, 'OBK-2026-000001'));

    // A different invoice taking the SAME number in the SAME tenant is rejected by the unique index.
    const third = await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m3')));
    await expect(
      runInTenantContext(ctx('t1'), () => invoices.assignNumber(third.id, 'OBK-2026-000001')),
    ).rejects.toThrow();
  });

  it('allows the same number across DIFFERENT tenants', async () => {
    const a = await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m1')));
    const b = await runInTenantContext(ctx('t2'), () => invoices.create(draftFields('m1')));
    await runInTenantContext(ctx('t1'), () => invoices.assignNumber(a.id, 'OBK-2026-000001'));
    const issuedB = await runInTenantContext(ctx('t2'), () =>
      invoices.assignNumber(b.id, 'OBK-2026-000001'),
    );
    expect(issuedB?.number).toBe('OBK-2026-000001');
  });

  it('claimForIssue is atomic and an issued invoice is immutable (review fix)', async () => {
    const inv = await runInTenantContext(ctx('t1'), () => invoices.create(draftFields('m1')));
    const claimed = await runInTenantContext(ctx('t1'), () =>
      invoices.claimForIssue(inv.id, '2026-01-01T00:00:00.000Z', '2026-01-15T00:00:00.000Z'),
    );
    expect(claimed?.status).toBe('open');
    // A second claim returns null — it is no longer a draft (concurrency/idempotency guard).
    const again = await runInTenantContext(ctx('t1'), () =>
      invoices.claimForIssue(inv.id, '2026-02-01T00:00:00.000Z', '2026-02-15T00:00:00.000Z'),
    );
    expect(again).toBeNull();
    // Reverting an issued invoice to draft is rejected (legal immutability).
    await expect(
      runInTenantContext(ctx('t1'), () => invoices.update(inv.id, { status: 'draft' })),
    ).rejects.toThrow();
  });
});

describe('Recurring billing idempotency index {tenantId, enrollmentId, periodStart}', () => {
  const recurringFields = (
    memberId: string,
    enrollmentId: string | null,
    periodStart: string | null,
  ) => ({
    memberId,
    enrollmentId,
    periodStart,
    periodEnd: periodStart ? '2026-07-01' : null,
    currency: 'SEK' as const,
    lines: [],
    subtotal: money(0, 'SEK'),
    vatTotal: money(0, 'SEK'),
    total: money(0, 'SEK'),
  });

  it('rejects a second invoice for the same (enrollment, period) — the double-bill backstop', async () => {
    await runInTenantContext(ctx('t1'), () =>
      invoices.create(recurringFields('m1', 'enr1', '2026-06-01')),
    );
    // Same enrollment + same periodStart in the same tenant → typed duplicate error.
    await expect(
      runInTenantContext(ctx('t1'), () =>
        invoices.create(recurringFields('m1', 'enr1', '2026-06-01')),
      ),
    ).rejects.toBeInstanceOf(DuplicateInvoicePeriodError);
  });

  it('allows different periods for the same enrollment, and the same period across tenants', async () => {
    await runInTenantContext(ctx('t1'), () =>
      invoices.create(recurringFields('m1', 'enr1', '2026-06-01')),
    );
    // Next period for the same enrollment is fine.
    await runInTenantContext(ctx('t1'), () =>
      invoices.create(recurringFields('m1', 'enr1', '2026-07-01')),
    );
    // Same enrollment+period in a DIFFERENT tenant is independent (index is tenant-scoped).
    const other = await runInTenantContext(ctx('t2'), () =>
      invoices.create(recurringFields('m1', 'enr1', '2026-06-01')),
    );
    expect(other.id).toBeTruthy();
  });

  it('does NOT constrain ad-hoc invoices (enrollmentId null) — partial index', async () => {
    await runInTenantContext(ctx('t1'), () => invoices.create(recurringFields('m1', null, null)));
    const second = await runInTenantContext(ctx('t1'), () =>
      invoices.create(recurringFields('m2', null, null)),
    );
    expect(second.id).toBeTruthy(); // two null-enrollment invoices coexist
  });

  it('findByEnrollmentPeriod returns the invoice for resume/idempotency', async () => {
    const created = await runInTenantContext(ctx('t1'), () =>
      invoices.create(recurringFields('m1', 'enr1', '2026-06-01')),
    );
    const found = await runInTenantContext(ctx('t1'), () =>
      invoices.findByEnrollmentPeriod('enr1', '2026-06-01'),
    );
    expect(found?.id).toBe(created.id);
    const missing = await runInTenantContext(ctx('t1'), () =>
      invoices.findByEnrollmentPeriod('enr1', '2026-08-01'),
    );
    expect(missing).toBeNull();
  });
});

describe('listDunnable + advanceDunningStep (dunning persistence)', () => {
  const open = (memberId: string, dueAt: string, nextRetryAt: string | null, stage = 0) => ({
    memberId,
    dueAt,
    nextRetryAt,
    stage,
  });

  /** Create an invoice and force it into an open/overdue dunning state via the raw model. */
  async function seedOpen(tenantId: string, o: ReturnType<typeof open>): Promise<string> {
    const inv = await runInTenantContext(ctx(tenantId), () =>
      invoices.create({
        memberId: o.memberId,
        currency: 'SEK',
        lines: [],
        subtotal: money(0, 'SEK'),
        vatTotal: money(0, 'SEK'),
        total: money(0, 'SEK'),
      }),
    );
    await mongoose.connection.collection('invoices').updateOne(
      { _id: new mongoose.Types.ObjectId(inv.id) },
      {
        $set: {
          status: 'open',
          dueAt: o.dueAt,
          nextRetryAt: o.nextRetryAt,
          dunningStage: o.stage,
        },
      },
    );
    return inv.id;
  }

  it('selects only open, past-due, retry-due invoices', async () => {
    const now = '2026-06-06T00:00:00.000Z';
    const dunnable = await seedOpen('t1', open('m1', '2026-05-01T00:00:00.000Z', null)); // overdue, never retried
    const inWindow = await seedOpen(
      't1',
      open('m2', '2026-05-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    ); // retry in future
    const notDue = await seedOpen('t1', open('m3', '2026-12-01T00:00:00.000Z', null)); // due in future

    const rows = await runInTenantContext(ctx('t1'), () => invoices.listDunnable(now));
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(dunnable);
    expect(ids).not.toContain(inWindow);
    expect(ids).not.toContain(notDue);
  });

  it('advanceDunningStep applies only at the expected open stage (atomic guard)', async () => {
    const id = await seedOpen('t1', open('m1', '2026-05-01T00:00:00.000Z', null, 1));
    // Wrong fromStage → null, no change.
    const miss = await runInTenantContext(ctx('t1'), () =>
      invoices.advanceDunningStep(id, 0, { dunningStage: 1, nextRetryAt: null }),
    );
    expect(miss).toBeNull();
    // Correct fromStage → advances atomically.
    const hit = await runInTenantContext(ctx('t1'), () =>
      invoices.advanceDunningStep(id, 1, {
        dunningStage: 2,
        nextRetryAt: '2026-06-09T00:00:00.000Z',
      }),
    );
    expect(hit?.dunningStage).toBe(2);
    // Re-applying the same step is now a no-op (precondition gone) — idempotent under re-delivery.
    const again = await runInTenantContext(ctx('t1'), () =>
      invoices.advanceDunningStep(id, 1, { dunningStage: 2, nextRetryAt: null }),
    );
    expect(again).toBeNull();
  });
});

describe('listDueForBilling (recurring candidate query)', () => {
  async function seedEnrollment(
    tenantId: string,
    fields: {
      memberId: string;
      status: string;
      startDate: string;
      currentPeriodEnd: string | null;
    },
  ): Promise<string> {
    const enr = await runInTenantContext(ctx(tenantId), () =>
      enrollments.create({
        memberId: fields.memberId,
        planId: 'plan1',
        startDate: fields.startDate,
      }),
    );
    await mongoose.connection
      .collection('enrollments')
      .updateOne(
        { _id: new mongoose.Types.ObjectId(enr.id) },
        { $set: { status: fields.status, currentPeriodEnd: fields.currentPeriodEnd } },
      );
    return enr.id;
  }

  it('returns active, started, period-ended enrollments and excludes frozen/future/already-current', async () => {
    const due = await seedEnrollment('t1', {
      memberId: 'm1',
      status: 'active',
      startDate: '2026-05-01',
      currentPeriodEnd: '2026-06-01',
    }); // active, period ended
    const firstBill = await seedEnrollment('t1', {
      memberId: 'm2',
      status: 'active',
      startDate: '2026-05-15',
      currentPeriodEnd: null,
    }); // active, never billed, started
    const frozen = await seedEnrollment('t1', {
      memberId: 'm3',
      status: 'frozen',
      startDate: '2026-05-01',
      currentPeriodEnd: '2026-06-01',
    });
    const current = await seedEnrollment('t1', {
      memberId: 'm4',
      status: 'active',
      startDate: '2026-05-01',
      currentPeriodEnd: '2026-09-01',
    }); // period still running
    const future = await seedEnrollment('t1', {
      memberId: 'm5',
      status: 'active',
      startDate: '2026-12-01',
      currentPeriodEnd: null,
    }); // not started

    const rows = await runInTenantContext(ctx('t1'), () =>
      enrollments.listDueForBilling('2026-06-06'),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(due);
    expect(ids).toContain(firstBill);
    expect(ids).not.toContain(frozen);
    expect(ids).not.toContain(current);
    expect(ids).not.toContain(future);
  });
});
