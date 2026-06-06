import { type AuthzActor, can } from '@obikai/authz';
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
} from '@obikai/domain';

/**
 * BillingService — the framework-free orchestration of the billing lifecycle (ADR-0013). It NEVER
 * reinvents money math: it composes the pure `@obikai/domain` helpers (`buildInvoiceLine`,
 * `invoiceTotals`) to build VAT-correct invoice lines and totals. The mutating operations
 * (issuing, recording a payment) are RBAC-gated on the `invoice` resource. Gapless invoice numbers
 * are allocated ONLY at issue time from the per-tenant counter (drafts have `number: null`).
 * Payment provider handling is deliberately minimal — the default `manual` adapter (cash/bank
 * transfer) needs no PSP; real PSP webhooks (ADR-0006) drive `recordPaymentResult` later.
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}

/** Number of failed dunning stages after which the linked enrollment is suspended (ADR-0013). */
export const DUNNING_SUSPEND_STAGE = 4;
/** Days between dunning retries; advanced as `nextRetryAt` each stage. */
const DUNNING_RETRY_DAYS = 3;
/** Default net payment terms (days) from issue to due date. */
const DEFAULT_DUE_DAYS = 14;

/** The persistence surfaces BillingService composes (satisfied by @obikai/db repositories). */
export interface BillingPlanStore {
  findById(id: string): Promise<Plan | null>;
}
export interface BillingVatRateStore {
  findById(id: string): Promise<VatRate | null>;
}
export interface BillingEnrollmentStore {
  findById(id: string): Promise<Enrollment | null>;
  update(id: string, patch: { status?: Enrollment['status'] }): Promise<Enrollment | null>;
}
export interface BillingInvoiceStore {
  create(input: {
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
  }): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  /** Atomic draft→open claim (concurrency guard). Returns null if not a draft. */
  claimForIssue(id: string, issuedAt: string, dueAt: string): Promise<Invoice | null>;
  /** Assign the gapless number exactly once (only when still null). */
  assignNumber(id: string, number: string): Promise<Invoice | null>;
  update(
    id: string,
    patch: {
      status?: Invoice['status'];
      issuedAt?: string | null;
      dueAt?: string | null;
      paidAt?: string | null;
      dunningStage?: number;
      nextRetryAt?: string | null;
    },
  ): Promise<Invoice | null>;
}
export interface BillingPaymentStore {
  listByInvoice(invoiceId: string): Promise<PaymentAttempt[]>;
  create(input: {
    invoiceId: string;
    provider?: string;
    providerChargeRef?: string | null;
    amount: Money;
    status?: PaymentAttemptStatus;
    idempotencyKey: string;
    attemptNo?: number;
    failureReason?: string | null;
  }): Promise<PaymentAttempt>;
}
export interface BillingCounterStore {
  allocateInvoiceNumber(tenantId: string, year: number): Promise<string>;
}

export interface BillingStores {
  plans: BillingPlanStore;
  vatRates: BillingVatRateStore;
  enrollments: BillingEnrollmentStore;
  invoices: BillingInvoiceStore;
  payments: BillingPaymentStore;
  counters: BillingCounterStore;
}

/** Outcome reported by the payment adapter (or a PSP webhook, ADR-0006). */
export interface PaymentResult {
  invoiceId: string;
  provider?: string;
  providerChargeRef?: string | null;
  amount: Money;
  status: PaymentAttemptStatus;
  idempotencyKey: string;
  failureReason?: string | null;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export class BillingService {
  constructor(
    private readonly stores: BillingStores,
    /** Injectable clock so issue/due/retry timestamps are deterministic in tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Build a draft invoice for an enrollment from its plan price + VAT rate, allocate the gapless
   * number, and mark it open. The line/total math is delegated entirely to the domain helpers.
   */
  async issueInvoiceForEnrollment(actor: AuthzActor, enrollmentId: string): Promise<Invoice> {
    if (!can(actor, { resource: 'invoice', action: 'create' }))
      throw new ForbiddenError('create', 'invoice');

    const enrollment = await this.stores.enrollments.findById(enrollmentId);
    if (!enrollment) throw new NotFoundError('enrollment', enrollmentId);

    const plan = await this.stores.plans.findById(enrollment.planId);
    if (!plan) throw new NotFoundError('plan', enrollment.planId);

    // Resolve the VAT percent (0 when the plan has no VAT rate attached).
    let vatPercent = 0;
    if (plan.vatRateId !== null) {
      const vatRate = await this.stores.vatRates.findById(plan.vatRateId);
      if (!vatRate) throw new NotFoundError('vatRate', plan.vatRateId);
      vatPercent = vatRate.percent;
    }

    const currency = plan.price.currency;
    const line = buildInvoiceLine(plan.name, 1, plan.price, vatPercent);
    const totals = invoiceTotals([line], currency);

    // Persist as a draft first (number stays null until we successfully allocate one).
    const draft = await this.stores.invoices.create({
      memberId: enrollment.memberId,
      status: 'draft',
      currency,
      lines: [line],
      subtotal: totals.subtotal,
      vatTotal: totals.vatTotal,
      total: totals.total,
    });

    return this.issue(actor, draft.id);
  }

  /** Assign the gapless number + set status 'open' + issuedAt/dueAt on an existing draft invoice. */
  async issue(actor: AuthzActor, invoiceId: string): Promise<Invoice> {
    if (!can(actor, { resource: 'invoice', action: 'create' }))
      throw new ForbiddenError('create', 'invoice');

    const issuedAt = this.now().toISOString();
    const dueAt = addDays(issuedAt, DEFAULT_DUE_DAYS);

    // Atomically claim the draft (draft → open). Only one concurrent caller can win, so the number
    // below is allocated AT MOST ONCE per invoice — closing the TOCTOU double-allocation gap.
    const claimed = await this.stores.invoices.claimForIssue(invoiceId, issuedAt, dueAt);
    if (!claimed) {
      const existing = await this.stores.invoices.findById(invoiceId);
      if (!existing) throw new NotFoundError('invoice', invoiceId);
      throw new BillingError(`invoice ${invoiceId} is not a draft (status=${existing.status})`);
    }

    // We won the claim → allocate the gapless number for the issue year and assign it once.
    const year = this.now().getUTCFullYear();
    const number = await this.stores.counters.allocateInvoiceNumber(claimed.tenantId, year);
    const issued = await this.stores.invoices.assignNumber(invoiceId, number);
    if (!issued) throw new BillingError(`failed to assign number to invoice ${invoiceId}`);
    return issued;
  }

  /**
   * Append a PaymentAttempt and mark the invoice paid/failed accordingly. The provider/charge
   * handling is minimal (manual/stub adapter is the default); real PSP results arrive via signed
   * webhooks (ADR-0006), never the client.
   */
  async recordPaymentResult(actor: AuthzActor, result: PaymentResult): Promise<PaymentAttempt> {
    if (!can(actor, { resource: 'payment', action: 'create' }))
      throw new ForbiddenError('create', 'payment');

    const invoice = await this.stores.invoices.findById(result.invoiceId);
    if (!invoice) throw new NotFoundError('invoice', result.invoiceId);

    // Payment currency must match the invoice currency.
    if (result.amount.currency !== invoice.currency) {
      throw new BillingError(
        `payment currency ${result.amount.currency} does not match invoice currency ${invoice.currency}`,
      );
    }

    const prior = await this.stores.payments.listByInvoice(result.invoiceId);
    // Idempotent: a replayed webhook (same idempotencyKey) is a clean no-op (ADR-0006/0013).
    const duplicate = prior.find((p) => p.idempotencyKey === result.idempotencyKey);
    if (duplicate) return duplicate;

    const attempt = await this.stores.payments.create({
      invoiceId: result.invoiceId,
      provider: result.provider ?? 'manual',
      providerChargeRef: result.providerChargeRef ?? null,
      amount: result.amount,
      status: result.status,
      idempotencyKey: result.idempotencyKey,
      attemptNo: prior.length + 1,
      failureReason: result.failureReason ?? null,
    });

    if (result.status === 'succeeded') {
      await this.stores.invoices.update(result.invoiceId, {
        status: 'paid',
        paidAt: this.now().toISOString(),
        dunningStage: 0,
        nextRetryAt: null,
      });
    }
    // A 'failed' attempt does not flip the invoice itself; the dunning ladder (advanceDunning,
    // worker-driven) decides retries/suspension. Other statuses (pending/processing/refunded) are
    // recorded only.
    return attempt;
  }

  /**
   * Pure-ish dunning ladder transition (ADR-0013). Advances `dunningStage` + `nextRetryAt`; once
   * the stage reaches DUNNING_SUSPEND_STAGE it suspends (cancels) the linked enrollment. Worker
   * driven; the payment state itself only ever changes via `recordPaymentResult`.
   */
  async advanceDunning(
    actor: AuthzActor,
    invoiceId: string,
    enrollmentId?: string,
  ): Promise<Invoice> {
    if (!can(actor, { resource: 'invoice', action: 'update' }))
      throw new ForbiddenError('update', 'invoice');

    const invoice = await this.stores.invoices.findById(invoiceId);
    if (!invoice) throw new NotFoundError('invoice', invoiceId);

    const nowIso = this.now().toISOString();
    // Only OPEN invoices are dunned — paid/void/uncollectible are no-ops. Combined with the
    // retry-window check below, this makes advanceDunning idempotent against re-delivered worker
    // jobs (ADR-0013): a duplicate run before nextRetryAt cannot double-increment the stage.
    if (invoice.status !== 'open') return invoice;
    if (invoice.nextRetryAt !== null && nowIso < invoice.nextRetryAt) return invoice;

    // If an enrollment is supplied, it MUST belong to this invoice's member — never suspend an
    // unrelated member's enrollment (within-tenant correctness).
    let enrollment = null;
    if (enrollmentId !== undefined) {
      enrollment = await this.stores.enrollments.findById(enrollmentId);
      if (!enrollment) throw new NotFoundError('enrollment', enrollmentId);
      if (enrollment.memberId !== invoice.memberId) {
        throw new BillingError('enrollment does not belong to the invoice member');
      }
    }

    const nextStage = invoice.dunningStage + 1;
    if (nextStage >= DUNNING_SUSPEND_STAGE) {
      // Final rung: mark the invoice uncollectible and suspend the verified linked enrollment.
      if (enrollment) {
        await this.stores.enrollments.update(enrollment.id, { status: 'frozen' });
      }
      const suspended = await this.stores.invoices.update(invoiceId, {
        status: 'uncollectible',
        dunningStage: nextStage,
        nextRetryAt: null,
      });
      if (!suspended) throw new NotFoundError('invoice', invoiceId);
      return suspended;
    }

    const advanced = await this.stores.invoices.update(invoiceId, {
      dunningStage: nextStage,
      nextRetryAt: addDays(nowIso, DUNNING_RETRY_DAYS),
    });
    if (!advanced) throw new NotFoundError('invoice', invoiceId);
    return advanced;
  }
}
