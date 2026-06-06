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
  type BillingService,
  BillingService as BillingServiceClass,
  type BillingVatRateStore,
  ForbiddenError,
} from './billing.service.js';

/** In-memory fakes — let us unit-test RBAC + the money composition without Nest or Mongo. */
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
  constructor(private readonly enrollments: Enrollment[]) {}
  async findById(id: string): Promise<Enrollment | null> {
    return this.enrollments.find((e) => e.id === id) ?? null;
  }
  async update(id: string, patch: { status?: Enrollment['status'] }): Promise<Enrollment | null> {
    const cur = this.enrollments.find((e) => e.id === id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Enrollment;
    const idx = this.enrollments.findIndex((e) => e.id === id);
    this.enrollments[idx] = next;
    return next;
  }
}

class FakeInvoiceStore implements BillingInvoiceStore {
  readonly byId = new Map<string, Invoice>();
  private seq = 0;
  constructor(private readonly tenantId = 't1') {}

  async create(input: {
    memberId: string;
    householdId?: string | null;
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
  async claimForIssue(id: string, issuedAt: string, dueAt: string): Promise<Invoice | null> {
    const cur = this.byId.get(id);
    // Atomic draft→open: only a draft can be claimed (mirrors the findOneAndUpdate guard).
    if (!cur || cur.status !== 'draft') return null;
    const next = { ...cur, status: 'open', issuedAt, dueAt } as Invoice;
    this.byId.set(id, next);
    return next;
  }
  async assignNumber(id: string, number: string): Promise<Invoice | null> {
    const cur = this.byId.get(id);
    // Number is assigned exactly once — only while still null (mirrors the {number:null} guard).
    if (!cur || cur.number !== null) return null;
    const next = { ...cur, number } as Invoice;
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

const enrollment: Enrollment = {
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

function makeService(): { svc: BillingService; invoices: FakeInvoiceStore } {
  const invoices = new FakeInvoiceStore();
  const svc = new BillingServiceClass(
    {
      plans: new FakePlanStore([plan]),
      vatRates: new FakeVatRateStore([vatRate]),
      enrollments: new FakeEnrollmentStore([{ ...enrollment }]),
      invoices,
      payments: new FakePaymentStore(),
      counters: new FakeCounterStore(),
    },
    () => new Date('2026-06-06T00:00:00.000Z'),
  );
  return { svc, invoices };
}

describe('BillingService.issueInvoiceForEnrollment', () => {
  it('produces a subtotal/vat/total matching the domain helpers and opens the invoice', async () => {
    const { svc } = makeService();
    const issued = await svc.issueInvoiceForEnrollment(owner, 'enr1');

    // Expected math computed independently via the SAME pure helpers (no reinvention).
    const expectedLine = buildInvoiceLine(plan.name, 1, plan.price, vatRate.percent);
    const expectedTotals = invoiceTotals([expectedLine], 'SEK');

    expect(issued.subtotal).toEqual(expectedTotals.subtotal); // 49900 net
    expect(issued.vatTotal).toEqual(expectedTotals.vatTotal); // 25% = 12475
    expect(issued.total).toEqual(expectedTotals.total); // 62375
    expect(issued.subtotal.amountMinor).toBe(49900);
    expect(issued.vatTotal.amountMinor).toBe(12475);
    expect(issued.total.amountMinor).toBe(62375);

    // Issuing assigns the gapless number + opens it + sets issued/due dates.
    expect(issued.status).toBe('open');
    expect(issued.number).toBe('OBK-2026-000001');
    expect(issued.issuedAt).toBe('2026-06-06T00:00:00.000Z');
    expect(issued.dueAt).not.toBeNull();
  });

  it('denies a non-authorized actor (bare member cannot issue invoices)', async () => {
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
    const after = await invoices.findById(issued.id);
    expect(after?.status).toBe('paid');
    expect(after?.paidAt).not.toBeNull();
  });

  it('denies a bare member from recording a payment', async () => {
    const { svc } = makeService();
    const issued = await svc.issueInvoiceForEnrollment(owner, 'enr1');
    await expect(
      svc.recordPaymentResult(member, {
        invoiceId: issued.id,
        amount: issued.total,
        status: 'succeeded',
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
