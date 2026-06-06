import type { AuthzActor } from '@obikai/authz';
import {
  type Currency,
  type Enrollment,
  type Invoice,
  type InvoiceLine,
  type Money,
  type PaymentAttempt,
  type PaymentAttemptStatus,
  type Plan,
  type VatRate,
  buildInvoiceLine,
  invoiceTotals,
  money,
} from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BillingCounterStore,
  type BillingEnrollmentStore,
  type BillingInvoiceStore,
  type BillingPaymentStore,
  type BillingPlanStore,
  BillingService,
  type BillingVatRateStore,
  ForbiddenError,
} from '../src/billing.service.js';

/** In-memory fakes — unit-test RBAC + money composition + idempotency without Nest or Mongo. */
class FakePlanStore implements BillingPlanStore {
  constructor(private readonly plans: Plan[]) {}
  async findById(id: string): Promise<Plan | null> {
    return this.plans.find((p) => p.id === id) ?? null;
  }
}

class FakeVatRateStore implements BillingVatRateStore {
  constructor(private readonly rates: VatRate[]) {}
  async findById(id: string): Promise<VatRate | null> {
    return this.rates.find((r) => r.id === id) ?? null;
  }
}

class FakeEnrollmentStore implements BillingEnrollmentStore {
  readonly byId = new Map<string, Enrollment>();
  constructor(enrollments: Enrollment[]) {
    for (const e of enrollments) this.byId.set(e.id, e);
  }
  async findById(id: string): Promise<Enrollment | null> {
    return this.byId.get(id) ?? null;
  }
  async update(
    id: string,
    patch: {
      status?: Enrollment['status'];
      currentPeriodStart?: string | null;
      currentPeriodEnd?: string | null;
    },
  ): Promise<Enrollment | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Enrollment;
    this.byId.set(id, next);
    return next;
  }
  async listDueForBilling(asOf: string): Promise<Enrollment[]> {
    return [...this.byId.values()].filter(
      (e) =>
        e.status === 'active' &&
        e.startDate <= asOf &&
        (e.currentPeriodEnd === null || e.currentPeriodEnd <= asOf),
    );
  }
}

class FakeInvoiceStore implements BillingInvoiceStore {
  readonly byId = new Map<string, Invoice>();
  private seq = 0;
  constructor(private readonly tenantId = 't1') {}

  async create(input: {
    memberId: string;
    householdId?: string | null;
    enrollmentId?: string | null;
    periodStart?: string | null;
    periodEnd?: string | null;
    status?: Invoice['status'];
    currency: Currency;
    lines: readonly InvoiceLine[];
    subtotal: Money;
    vatTotal: Money;
    total: Money;
    reverseCharge?: boolean;
    dueAt?: string | null;
  }): Promise<Invoice> {
    const id = `inv${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const inv: Invoice = {
      id: id as Invoice['id'],
      tenantId: this.tenantId as Invoice['tenantId'],
      number: null,
      memberId: input.memberId as Invoice['memberId'],
      householdId: (input.householdId ?? null) as Invoice['householdId'],
      enrollmentId: (input.enrollmentId ?? null) as Invoice['enrollmentId'],
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
      status: input.status ?? 'draft',
      currency: input.currency,
      lines: input.lines,
      subtotal: input.subtotal,
      vatTotal: input.vatTotal,
      total: input.total,
      reverseCharge: input.reverseCharge ?? false,
      sellerVatId: null,
      buyerVatId: null,
      issuedAt: null,
      dueAt: input.dueAt ?? null,
      paidAt: null,
      dunningStage: 0,
      nextRetryAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, inv);
    return inv;
  }
  async findById(id: string): Promise<Invoice | null> {
    return this.byId.get(id) ?? null;
  }
  async findByEnrollmentPeriod(enrollmentId: string, periodStart: string): Promise<Invoice | null> {
    for (const inv of this.byId.values()) {
      if (inv.enrollmentId === enrollmentId && inv.periodStart === periodStart) return inv;
    }
    return null;
  }
  async listDunnable(nowIso: string): Promise<Invoice[]> {
    return [...this.byId.values()].filter(
      (i) =>
        i.status === 'open' &&
        i.dueAt !== null &&
        i.dueAt < nowIso &&
        (i.nextRetryAt === null || i.nextRetryAt <= nowIso),
    );
  }
  async claimForIssue(id: string, issuedAt: string, dueAt: string): Promise<Invoice | null> {
    const cur = this.byId.get(id);
    if (!cur || cur.status !== 'draft') return null;
    const next = { ...cur, status: 'open', issuedAt, dueAt } as Invoice;
    this.byId.set(id, next);
    return next;
  }
  async assignNumber(id: string, number: string): Promise<Invoice | null> {
    const cur = this.byId.get(id);
    if (!cur || cur.number !== null) return null;
    const next = { ...cur, number } as Invoice;
    this.byId.set(id, next);
    return next;
  }
  async advanceDunningStep(
    id: string,
    fromStage: number,
    patch: { status?: Invoice['status']; dunningStage: number; nextRetryAt: string | null },
  ): Promise<Invoice | null> {
    const cur = this.byId.get(id);
    // Atomic guard: only apply when still open at the expected stage (mirrors findOneAndUpdate).
    if (!cur || cur.status !== 'open' || cur.dunningStage !== fromStage) return null;
    const next = { ...cur, ...patch } as Invoice;
    this.byId.set(id, next);
    return next;
  }
  async update(id: string, patch: Partial<Invoice>): Promise<Invoice | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Invoice;
    this.byId.set(id, next);
    return next;
  }
}

class FakePaymentStore implements BillingPaymentStore {
  readonly attempts: PaymentAttempt[] = [];
  async listByInvoice(invoiceId: string): Promise<PaymentAttempt[]> {
    return this.attempts.filter((a) => a.invoiceId === invoiceId);
  }
  async create(input: {
    invoiceId: string;
    provider?: string;
    providerChargeRef?: string | null;
    amount: Money;
    status?: PaymentAttemptStatus;
    idempotencyKey: string;
    attemptNo?: number;
    failureReason?: string | null;
  }): Promise<PaymentAttempt> {
    const now = '2026-06-06T00:00:00.000Z';
    const attempt: PaymentAttempt = {
      id: `pa${this.attempts.length + 1}`,
      tenantId: 't1' as PaymentAttempt['tenantId'],
      invoiceId: input.invoiceId as PaymentAttempt['invoiceId'],
      provider: input.provider ?? 'manual',
      providerChargeRef: input.providerChargeRef ?? null,
      amount: input.amount,
      status: input.status ?? 'pending',
      idempotencyKey: input.idempotencyKey,
      attemptNo: input.attemptNo ?? 1,
      failureReason: input.failureReason ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.attempts.push(attempt);
    return attempt;
  }
}

class FakeCounterStore implements BillingCounterStore {
  private seq = 0;
  async allocateInvoiceNumber(_tenantId: string, year: number): Promise<string> {
    return `OBK-${year}-${String(++this.seq).padStart(6, '0')}`;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

const vatRate: VatRate = {
  id: 'vat25' as VatRate['id'],
  tenantId: 't1' as VatRate['tenantId'],
  name: 'Standard',
  percent: 25,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
};

const plan: Plan = {
  id: 'plan1' as Plan['id'],
  tenantId: 't1' as Plan['tenantId'],
  name: 'Adult Monthly',
  type: 'recurring',
  price: money(49900, 'SEK'),
  interval: 'monthly',
  vatRateId: 'vat25' as Plan['vatRateId'],
  classPackCredits: null,
  active: true,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
};

const baseEnrollment: Enrollment = {
  id: 'enr1' as Enrollment['id'],
  tenantId: 't1' as Enrollment['tenantId'],
  memberId: 'm1' as Enrollment['memberId'],
  planId: 'plan1' as Enrollment['planId'],
  status: 'active',
  startDate: '2026-06-01',
  currentPeriodStart: null,
  currentPeriodEnd: null,
  freezeFrom: null,
  freezeUntil: null,
  cancelAt: null,
  mandateRef: null,
  createdAt: '2026-06-06T00:00:00.000Z',
  updatedAt: '2026-06-06T00:00:00.000Z',
};

// Fixed clock: 2026-06-06 → asOf 2026-06-06; the June period [06-01, 07-01) is due, July is not.
const CLOCK = () => new Date('2026-06-06T00:00:00.000Z');

function makeService(over: { plans?: Plan[]; enrollments?: Enrollment[] } = {}): {
  svc: BillingService;
  invoices: FakeInvoiceStore;
  enrollments: FakeEnrollmentStore;
} {
  const invoices = new FakeInvoiceStore();
  const enrollments = new FakeEnrollmentStore(over.enrollments ?? [{ ...baseEnrollment }]);
  const svc = new BillingService(
    {
      plans: new FakePlanStore(over.plans ?? [plan]),
      vatRates: new FakeVatRateStore([vatRate]),
      enrollments,
      invoices,
      payments: new FakePaymentStore(),
      counters: new FakeCounterStore(),
    },
    CLOCK,
  );
  return { svc, invoices, enrollments };
}

describe('BillingService.issueInvoiceForEnrollment', () => {
  it('produces subtotal/vat/total via the domain helpers and opens the invoice', async () => {
    const { svc } = makeService();
    const issued = await svc.issueInvoiceForEnrollment(owner, 'enr1');
    const expected = invoiceTotals([buildInvoiceLine(plan.name, 1, plan.price, 25)], 'SEK');
    expect(issued.subtotal.amountMinor).toBe(49900);
    expect(issued.vatTotal.amountMinor).toBe(12475);
    expect(issued.total).toEqual(expected.total);
    expect(issued.status).toBe('open');
    expect(issued.number).toBe('OBK-2026-000001');
  });
  it('denies a bare member', async () => {
    const { svc } = makeService();
    await expect(svc.issueInvoiceForEnrollment(member, 'enr1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('BillingService.recordPaymentResult', () => {
  it('marks the invoice paid on a succeeded attempt', async () => {
    const { svc, invoices } = makeService();
    const issued = await svc.issueInvoiceForEnrollment(owner, 'enr1');
    await svc.recordPaymentResult(owner, {
      invoiceId: issued.id,
      amount: issued.total,
      status: 'succeeded',
      idempotencyKey: 'idem-1',
    });
    expect((await invoices.findById(issued.id))?.status).toBe('paid');
  });
  it('is a no-op on a replayed idempotencyKey (no second attempt)', async () => {
    const { svc } = makeService();
    const issued = await svc.issueInvoiceForEnrollment(owner, 'enr1');
    const a = await svc.recordPaymentResult(owner, {
      invoiceId: issued.id,
      amount: issued.total,
      status: 'succeeded',
      idempotencyKey: 'dup',
    });
    const b = await svc.recordPaymentResult(owner, {
      invoiceId: issued.id,
      amount: issued.total,
      status: 'succeeded',
      idempotencyKey: 'dup',
    });
    expect(b.id).toBe(a.id);
  });
  it('rejects a currency mismatch', async () => {
    const { svc } = makeService();
    const issued = await svc.issueInvoiceForEnrollment(owner, 'enr1');
    await expect(
      svc.recordPaymentResult(owner, {
        invoiceId: issued.id,
        amount: money(issued.total.amountMinor, 'EUR'),
        status: 'succeeded',
        idempotencyKey: 'x',
      }),
    ).rejects.toThrow();
  });
});

describe('BillingService.billRecurringForEnrollment', () => {
  it('issues the first period invoice, tagged with enrollment + period, and advances the cursor', async () => {
    const { svc, enrollments } = makeService();
    const inv = await svc.billRecurringForEnrollment(owner, 'enr1');
    expect(inv).not.toBeNull();
    expect(inv?.status).toBe('open');
    expect(inv?.number).toBe('OBK-2026-000001');
    expect(inv?.enrollmentId).toBe('enr1');
    expect(inv?.periodStart).toBe('2026-06-01');
    expect(inv?.periodEnd).toBe('2026-07-01');
    // Enrollment cursor advanced to the billed period.
    const enr = await enrollments.findById('enr1');
    expect(enr?.currentPeriodStart).toBe('2026-06-01');
    expect(enr?.currentPeriodEnd).toBe('2026-07-01');
  });

  it('does NOT double-bill: a second run in the same period returns null (next period not started)', async () => {
    const { svc, invoices } = makeService();
    await svc.billRecurringForEnrollment(owner, 'enr1');
    const second = await svc.billRecurringForEnrollment(owner, 'enr1');
    expect(second).toBeNull();
    expect(invoices.byId.size).toBe(1); // exactly one invoice exists
  });

  it('self-heals a crashed run: cursor not advanced but an issued invoice exists → no new invoice, re-advances', async () => {
    // Simulate: previous run issued the June invoice but crashed before advancing the cursor.
    const enr: Enrollment = { ...baseEnrollment, currentPeriodEnd: null };
    const { svc, invoices, enrollments } = makeService({ enrollments: [enr] });
    // Seed an already-issued invoice for the June period.
    const seeded = await invoices.create({
      memberId: 'm1',
      enrollmentId: 'enr1',
      periodStart: '2026-06-01',
      periodEnd: '2026-07-01',
      status: 'draft',
      currency: 'SEK',
      lines: [],
      subtotal: money(0, 'SEK'),
      vatTotal: money(0, 'SEK'),
      total: money(0, 'SEK'),
    });
    await invoices.claimForIssue(seeded.id, '2026-06-06T00:00:00.000Z', '2026-06-20T00:00:00.000Z');
    await invoices.assignNumber(seeded.id, 'OBK-2026-000001');

    const inv = await svc.billRecurringForEnrollment(owner, 'enr1');
    expect(inv?.id).toBe(seeded.id); // returns the existing issued invoice, not a new one
    expect(invoices.byId.size).toBe(1); // no duplicate created
    expect((await enrollments.findById('enr1'))?.currentPeriodEnd).toBe('2026-07-01'); // re-advanced
  });

  it('resumes a leftover DRAFT for the period (issues it) instead of creating a new one', async () => {
    const enr: Enrollment = { ...baseEnrollment, currentPeriodEnd: null };
    const { svc, invoices } = makeService({ enrollments: [enr] });
    const draft = await invoices.create({
      memberId: 'm1',
      enrollmentId: 'enr1',
      periodStart: '2026-06-01',
      periodEnd: '2026-07-01',
      status: 'draft',
      currency: 'SEK',
      lines: [],
      subtotal: money(0, 'SEK'),
      vatTotal: money(0, 'SEK'),
      total: money(0, 'SEK'),
    });
    const inv = await svc.billRecurringForEnrollment(owner, 'enr1');
    expect(inv?.id).toBe(draft.id);
    expect(inv?.status).toBe('open');
    expect(inv?.number).toBe('OBK-2026-000001');
    expect(invoices.byId.size).toBe(1);
  });

  it('returns null for a non-recurring plan', async () => {
    const dropIn: Plan = { ...plan, interval: 'none', type: 'drop_in' };
    const { svc, invoices } = makeService({
      plans: [dropIn],
      enrollments: [{ ...baseEnrollment }],
    });
    expect(await svc.billRecurringForEnrollment(owner, 'enr1')).toBeNull();
    expect(invoices.byId.size).toBe(0);
  });

  it('returns null for an inactive (frozen) enrollment', async () => {
    const frozen: Enrollment = { ...baseEnrollment, status: 'frozen' };
    const { svc } = makeService({ enrollments: [frozen] });
    expect(await svc.billRecurringForEnrollment(owner, 'enr1')).toBeNull();
  });

  it('returns null when the period has not started yet', async () => {
    const future: Enrollment = { ...baseEnrollment, startDate: '2026-09-01' };
    const { svc } = makeService({ enrollments: [future] });
    expect(await svc.billRecurringForEnrollment(owner, 'enr1')).toBeNull();
  });

  it('resumes idempotently when create loses the unique-index race (review fix)', async () => {
    const enr: Enrollment = { ...baseEnrollment, currentPeriodEnd: null };
    const { svc, invoices, enrollments } = makeService({ enrollments: [enr] });
    // Simulate a concurrent winner: our create() lands the winner's invoice, then throws as if the
    // unique index rejected OUR insert. billRecurring must re-query, resume, and advance the cursor.
    const origCreate = invoices.create.bind(invoices);
    invoices.create = (async (input: Parameters<FakeInvoiceStore['create']>[0]) => {
      await origCreate({ ...input, status: 'open' }); // the concurrent winner's (already-issued) invoice
      throw Object.assign(new Error('dup'), { name: 'DuplicateInvoicePeriodError' });
    }) as FakeInvoiceStore['create'];

    const inv = await svc.billRecurringForEnrollment(owner, 'enr1');
    expect(inv).not.toBeNull();
    expect(inv?.enrollmentId).toBe('enr1');
    expect(invoices.byId.size).toBe(1); // only the winner's invoice — no duplicate
    expect((await enrollments.findById('enr1'))?.currentPeriodEnd).toBe('2026-07-01'); // cursor advanced
  });

  it('rethrows a genuine create failure (not a duplicate race) without advancing the cursor', async () => {
    const enr: Enrollment = { ...baseEnrollment, currentPeriodEnd: null };
    const { svc, invoices, enrollments } = makeService({ enrollments: [enr] });
    invoices.create = (async () => {
      throw new Error('db down'); // nothing lands → re-query finds nothing → rethrow
    }) as FakeInvoiceStore['create'];
    await expect(svc.billRecurringForEnrollment(owner, 'enr1')).rejects.toThrow('db down');
    expect((await enrollments.findById('enr1'))?.currentPeriodEnd).toBeNull(); // cursor untouched
  });

  it('denies a bare member', async () => {
    const { svc } = makeService();
    await expect(svc.billRecurringForEnrollment(member, 'enr1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe('BillingService.advanceDunning', () => {
  /** Helper: an OPEN, past-due invoice linked to enr1, at a given dunning stage. */
  async function openOverdue(invoices: FakeInvoiceStore, stage: number): Promise<Invoice> {
    const inv = await invoices.create({
      memberId: 'm1',
      enrollmentId: 'enr1',
      currency: 'SEK',
      lines: [],
      subtotal: money(0, 'SEK'),
      vatTotal: money(0, 'SEK'),
      total: money(0, 'SEK'),
    });
    return (await invoices.update(inv.id, {
      status: 'open',
      dueAt: '2026-05-01T00:00:00.000Z', // before the clock → overdue
      dunningStage: stage,
      nextRetryAt: null,
    })) as Invoice;
  }

  it('advances the stage and sets the next retry window', async () => {
    const { svc, invoices } = makeService();
    const inv = await openOverdue(invoices, 0);
    const after = await svc.advanceDunning(owner, inv.id);
    expect(after.dunningStage).toBe(1);
    expect(after.nextRetryAt).not.toBeNull();
    expect(after.status).toBe('open');
  });

  it('is idempotent within the retry window (no double-increment)', async () => {
    const { svc, invoices } = makeService();
    const inv = await openOverdue(invoices, 0);
    const once = await svc.advanceDunning(owner, inv.id);
    const twice = await svc.advanceDunning(owner, inv.id); // nextRetryAt in the future now
    expect(twice.dunningStage).toBe(once.dunningStage); // unchanged
  });

  it('suspends the linked enrollment and marks the invoice uncollectible at the final stage', async () => {
    const { svc, invoices, enrollments } = makeService();
    const inv = await openOverdue(invoices, 3); // next step → 4 == DUNNING_SUSPEND_STAGE
    const after = await svc.advanceDunning(owner, inv.id);
    expect(after.status).toBe('uncollectible');
    expect(after.dunningStage).toBe(4);
    expect((await enrollments.findById('enr1'))?.status).toBe('frozen');
  });

  it('is a no-op on a non-open (paid) invoice', async () => {
    const { svc, invoices } = makeService();
    const inv = await openOverdue(invoices, 0);
    await invoices.update(inv.id, { status: 'paid' });
    const after = await svc.advanceDunning(owner, inv.id);
    expect(after.status).toBe('paid');
    expect(after.dunningStage).toBe(0);
  });

  it('treats a lost atomic step (concurrent advance) as a no-op (review fix)', async () => {
    const { svc, invoices } = makeService();
    const inv = await openOverdue(invoices, 1);
    // Simulate a concurrent/re-delivered worker winning the guarded step: ours finds the precondition
    // gone and returns null. advanceDunning must NOT throw or double-advance — it returns current.
    invoices.advanceDunningStep = (async () => null) as FakeInvoiceStore['advanceDunningStep'];
    const after = await svc.advanceDunning(owner, inv.id);
    expect(after.id).toBe(inv.id);
    expect(after.dunningStage).toBe(1); // unchanged — the concurrent job owned the step
  });

  it('denies a bare member', async () => {
    const { svc, invoices } = makeService();
    const inv = await openOverdue(invoices, 0);
    await expect(svc.advanceDunning(member, inv.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
