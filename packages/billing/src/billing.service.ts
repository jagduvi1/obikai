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
  computeBillingPeriod,
  invoiceTotals,
} from '@obikai/domain';

/**
 * BillingService — the framework-free orchestration of the billing lifecycle (ADR-0013). It NEVER
 * reinvents money math: it composes the pure `@obikai/domain` helpers (`buildInvoiceLine`,
 * `invoiceTotals`, `computeBillingPeriod`) to build VAT-correct lines/totals and recurring periods.
 * The mutating operations are RBAC-gated on the `invoice`/`payment` resources; gapless invoice
 * numbers are allocated ONLY at issue time from the per-tenant counter (drafts have `number: null`).
 *
 * It depends only on `@obikai/domain` + `@obikai/authz` and on the structural store interfaces
 * below — satisfied by the `@obikai/db` repositories in the api (HTTP) and the worker (jobs). This
 * is why the SAME service drives both the request path and the automated billing-run/dunning jobs.
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
  update(
    id: string,
    patch: {
      status?: Enrollment['status'];
      currentPeriodStart?: string | null;
      currentPeriodEnd?: string | null;
    },
  ): Promise<Enrollment | null>;
  /** Active enrollments that may be due for billing as of `asOf` (a `YYYY-MM-DD`). */
  listDueForBilling(asOf: string): Promise<Enrollment[]>;
}
export interface BillingInvoiceStore {
  create(input: {
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
  }): Promise<Invoice>;
  findById(id: string): Promise<Invoice | null>;
  /** Idempotency/resume lookup: the invoice (if any) for an enrollment's billing period. */
  findByEnrollmentPeriod(enrollmentId: string, periodStart: string): Promise<Invoice | null>;
  /** Open, past-due invoices eligible for a dunning step as of `nowIso`. */
  listDunnable(nowIso: string): Promise<Invoice[]>;
  /**
   * Atomic single-write issue: draft→open + issuedAt/dueAt + the pre-allocated gapless `number`, all
   * at once (concurrency guard, returns null if not a draft). No "open without a number" intermediate.
   */
  claimForIssueWithNumber(
    id: string,
    opts: { issuedAt: string; dueAt: string; number: string },
  ): Promise<Invoice | null>;
  /**
   * Atomically apply a dunning step ONLY if the invoice is still open at `fromStage`. Returns the
   * updated invoice, or null if a concurrent/re-delivered worker already advanced it (the
   * precondition no longer matches) — making the ladder step idempotent under concurrency.
   */
  advanceDunningStep(
    id: string,
    fromStage: number,
    patch: { status?: Invoice['status']; dunningStage: number; nextRetryAt: string | null },
  ): Promise<Invoice | null>;
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
    /** Injectable clock so issue/due/retry/period timestamps are deterministic in tests. */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Resolve the VAT percent for a plan (0 when it has no VAT rate attached). */
  private async resolveVatPercent(plan: Plan): Promise<number> {
    if (plan.vatRateId === null) return 0;
    const vatRate = await this.stores.vatRates.findById(plan.vatRateId);
    if (!vatRate) throw new NotFoundError('vatRate', plan.vatRateId);
    return vatRate.percent;
  }

  /**
   * Build a draft invoice for an enrollment from its plan price + VAT rate, allocate the gapless
   * number, and mark it open. Ad-hoc (no service period); the line/total math is delegated entirely
   * to the domain helpers. For automated recurring billing use `billRecurringForEnrollment`.
   */
  async issueInvoiceForEnrollment(actor: AuthzActor, enrollmentId: string): Promise<Invoice> {
    if (!can(actor, { resource: 'invoice', action: 'create' }))
      throw new ForbiddenError('create', 'invoice');

    const enrollment = await this.stores.enrollments.findById(enrollmentId);
    if (!enrollment) throw new NotFoundError('enrollment', enrollmentId);

    const plan = await this.stores.plans.findById(enrollment.planId);
    if (!plan) throw new NotFoundError('plan', enrollment.planId);

    const vatPercent = await this.resolveVatPercent(plan);
    const currency = plan.price.currency;
    const line = buildInvoiceLine(plan.name, 1, plan.price, vatPercent);
    const totals = invoiceTotals([line], currency);

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

  /**
   * Issue an existing draft: allocate the gapless number and commit status 'open' + issuedAt/dueAt +
   * number in a SINGLE atomic write.
   *
   * Crash-safety (audit H4): the number is allocated FIRST, then `claimForIssueWithNumber` writes
   * status, dates and number together — so a crash can never leave a persisted "open invoice without
   * a number" (a legally-invalid issued invoice). We confirm the draft (and read its tenantId) before
   * allocating, so issuing an already-issued invoice never burns a number. The unavoidable residual
   * on single-node Mongo is a GAP: a crash between the counter `$inc` and the claim — or a concurrent
   * loser — leaves the allocated number unused. A gap is auditable and acceptable; an unnumbered
   * issued invoice is not. True two-document atomicity (counter + invoice) needs a Mongo transaction
   * on a replica set; tracked separately. Concurrency-safe & idempotent: the {status:'draft'} guard
   * means only one caller wins; a loser re-reads and returns the already-issued invoice.
   */
  async issue(actor: AuthzActor, invoiceId: string): Promise<Invoice> {
    if (!can(actor, { resource: 'invoice', action: 'create' }))
      throw new ForbiddenError('create', 'invoice');

    // Confirm it's a draft before allocating a number (so an already-issued invoice never burns one)
    // and to source the tenantId for the per-tenant counter from the invoice itself.
    const draft = await this.stores.invoices.findById(invoiceId);
    if (!draft) throw new NotFoundError('invoice', invoiceId);
    if (draft.status !== 'draft')
      throw new BillingError(`invoice ${invoiceId} is not a draft (status=${draft.status})`);

    // Read the clock ONCE so the printed number-year can never diverge from issuedAt (review fix).
    const now = this.now();
    const issuedAt = now.toISOString();
    const dueAt = addDays(issuedAt, DEFAULT_DUE_DAYS);
    const year = now.getUTCFullYear();

    // Allocate first, then commit status+dates+number in one write (see method doc for crash-safety).
    const number = await this.stores.counters.allocateInvoiceNumber(draft.tenantId, year);
    const issued = await this.stores.invoices.claimForIssueWithNumber(invoiceId, {
      issuedAt,
      dueAt,
      number,
    });
    if (issued) return issued;

    // Lost the draft→open race to a concurrent issue() (our allocated number is now an unused gap).
    // If the invoice is now issued, return it so the caller still sees a consistent result.
    const after = await this.stores.invoices.findById(invoiceId);
    if (after && after.status !== 'draft') return after;
    throw new BillingError(`failed to issue invoice ${invoiceId}`);
  }

  /**
   * Generate the next due recurring invoice for an enrollment and advance its billing cursor.
   * IDEMPOTENT: at most one invoice exists per (enrollment, periodStart) — a re-run resumes a
   * crashed draft or skips an already-issued period, never double-bills (the DB unique index is the
   * hard backstop; this method does the soft find-first + resume). Returns the issued invoice for
   * the period, or null when nothing is due (non-recurring plan, inactive enrollment, or the next
   * period hasn't started yet). Bills ONE period per call; successive runs catch up a lapsed
   * enrollment. Drives the worker's `billing-run` job.
   */
  async billRecurringForEnrollment(
    actor: AuthzActor,
    enrollmentId: string,
  ): Promise<Invoice | null> {
    if (!can(actor, { resource: 'invoice', action: 'create' }))
      throw new ForbiddenError('create', 'invoice');

    const enrollment = await this.stores.enrollments.findById(enrollmentId);
    if (!enrollment) throw new NotFoundError('enrollment', enrollmentId);
    if (enrollment.status !== 'active') return null;

    const plan = await this.stores.plans.findById(enrollment.planId);
    if (!plan) throw new NotFoundError('plan', enrollment.planId);

    const asOf = this.now().toISOString().slice(0, 10); // YYYY-MM-DD
    const period = computeBillingPeriod(
      plan.interval,
      enrollment.startDate,
      enrollment.currentPeriodEnd,
      asOf,
    );
    if (!period) return null; // non-recurring plan, or the next period hasn't started yet

    // Idempotency/resume: at most one invoice per (enrollment, periodStart). Find an existing one
    // (resume a draft / keep an issued one), else create. The create may still LOSE a unique-index
    // race to a concurrent run — caught below and resolved by re-querying, so the cursor still
    // advances (no enrollment left permanently stuck-due, review fix).
    let invoice = await this.stores.invoices.findByEnrollmentPeriod(
      enrollmentId,
      period.periodStart,
    );
    if (!invoice) {
      const vatPercent = await this.resolveVatPercent(plan);
      const currency = plan.price.currency;
      const line = buildInvoiceLine(plan.name, 1, plan.price, vatPercent);
      const totals = invoiceTotals([line], currency);
      try {
        invoice = await this.stores.invoices.create({
          memberId: enrollment.memberId,
          enrollmentId,
          periodStart: period.periodStart,
          periodEnd: period.periodEnd,
          status: 'draft',
          currency,
          lines: [line],
          subtotal: totals.subtotal,
          vatTotal: totals.vatTotal,
          total: totals.total,
        });
      } catch (err) {
        // A concurrent run created the invoice for this period first (the unique index rejected
        // ours). Re-query and resume idempotently; if nothing is there, it was a genuine failure.
        invoice = await this.stores.invoices.findByEnrollmentPeriod(
          enrollmentId,
          period.periodStart,
        );
        if (!invoice) throw err;
      }
    }

    const issued = await this.ensureIssued(actor, invoice);

    // Advance the enrollment cursor FORWARD only so the next run computes the FOLLOWING period.
    // Done AFTER issuing: if a previous run issued but crashed before advancing, the next run
    // recomputes the SAME period, resumes the invoice above, and re-advances — self-healing. The
    // forward-only guard keeps a stale/slow concurrent run from regressing the cursor (review fix).
    if (enrollment.currentPeriodEnd === null || period.periodEnd > enrollment.currentPeriodEnd) {
      await this.stores.enrollments.update(enrollmentId, {
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
      });
    }

    return issued;
  }

  /**
   * Issue a draft, tolerating a concurrent run that issued it first. `issue()` is already idempotent
   * under the draft→open race (it returns the issued invoice rather than throwing); this also catches
   * the case where the invoice flipped to non-draft between the caller's read and `issue()`, re-fetching
   * and returning the issued invoice instead of throwing. Keeps recurring billing idempotent.
   */
  private async ensureIssued(actor: AuthzActor, invoice: Invoice): Promise<Invoice> {
    if (invoice.status !== 'draft') return invoice;
    try {
      return await this.issue(actor, invoice.id);
    } catch (err) {
      const after = await this.stores.invoices.findById(invoice.id);
      if (after && after.status !== 'draft') return after;
      throw err;
    }
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
   * Advance ONE open, past-due invoice through the dunning ladder (ADR-0013): bumps `dunningStage`
   * + `nextRetryAt`; once the stage reaches DUNNING_SUSPEND_STAGE it marks the invoice
   * uncollectible and suspends (freezes) the enrollment the invoice bills (`invoice.enrollmentId`).
   * No-op unless the invoice is OPEN and past its `nextRetryAt`. The actual stage transition is an
   * ATOMIC guarded update (`advanceDunningStep`, conditioned on the current stage), so concurrent or
   * re-delivered jobs can never double-advance or skip a rung — at most one wins the step. Drives the
   * worker's `dunning` job.
   */
  async advanceDunning(actor: AuthzActor, invoiceId: string): Promise<Invoice> {
    if (!can(actor, { resource: 'invoice', action: 'update' }))
      throw new ForbiddenError('update', 'invoice');

    const invoice = await this.stores.invoices.findById(invoiceId);
    if (!invoice) throw new NotFoundError('invoice', invoiceId);

    const nowIso = this.now().toISOString();
    // Fast-path no-ops: only OPEN, past-retry-window invoices are dunned. The atomic step below is
    // the real guard against concurrency; these just avoid needless work.
    if (invoice.status !== 'open') return invoice;
    if (invoice.nextRetryAt !== null && nowIso < invoice.nextRetryAt) return invoice;

    // The enrollment to suspend (if any) is the one this invoice bills. It MUST belong to the
    // invoice's member — never suspend an unrelated member's enrollment (within-tenant correctness).
    let enrollment: Enrollment | null = null;
    if (invoice.enrollmentId !== null) {
      enrollment = await this.stores.enrollments.findById(invoice.enrollmentId);
      if (enrollment && enrollment.memberId !== invoice.memberId) {
        throw new BillingError('enrollment does not belong to the invoice member');
      }
    }

    const nextStage = invoice.dunningStage + 1;
    const isFinal = nextStage >= DUNNING_SUSPEND_STAGE;
    // Atomic transition: applies ONLY if the invoice is still open at this exact stage. A concurrent
    // job that already advanced it returns null here → we treat it as a no-op (re-read current).
    const stepped = await this.stores.invoices.advanceDunningStep(invoiceId, invoice.dunningStage, {
      ...(isFinal ? { status: 'uncollectible' as const } : {}),
      dunningStage: nextStage,
      nextRetryAt: isFinal ? null : addDays(nowIso, DUNNING_RETRY_DAYS),
    });
    if (!stepped) {
      // Lost the race to a concurrent/re-delivered job — return the now-current invoice, unchanged.
      return (await this.stores.invoices.findById(invoiceId)) ?? invoice;
    }

    // Only the winner of the final step suspends the enrollment (freeze is itself idempotent).
    if (isFinal && enrollment) {
      await this.stores.enrollments.update(enrollment.id, { status: 'frozen' });
    }
    return stepped;
  }
}
