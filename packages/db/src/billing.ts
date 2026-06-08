import type {
  BillingInterval,
  Currency,
  Enrollment,
  EnrollmentStatus,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Money,
  PaymentAttempt,
  PaymentAttemptStatus,
  Plan,
  PlanType,
  VatRate,
} from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard, tenantUniqueIndex } from './tenant-guard.js';

/**
 * Billing persistence (ADR-0011/0013). The §7 separations are preserved as distinct guarded
 * collections: VatRate, Plan, Enrollment, Invoice, PaymentAttempt — plus a per-tenant
 * InvoiceCounter that allocates GAPLESS, sequential invoice numbers (required for EU invoicing).
 * The `tenantGuard` plugin scopes every query/write to the active tenant; this layer only maps
 * between Mongoose docs and the `@obikai/domain` shapes and never reinvents the money math (the
 * pure helpers in `@obikai/domain/billing` own that). Money is stored as integer minor units +
 * currency (ADR-0013); invoice numbers are NEVER derived from `_id`/timestamps.
 */

// ── Embedded Money sub-schema ──────────────────────────────────────────────────
const moneySchema = new Schema(
  {
    amountMinor: { type: Number, required: true },
    currency: { type: String, required: true },
  },
  { _id: false },
);

function toMoney(doc: { amountMinor: number; currency: string }): Money {
  return { amountMinor: doc.amountMinor, currency: doc.currency as Currency };
}

// ── VatRate ────────────────────────────────────────────────────────────────────
export interface VatRateDoc extends TenantScoped {
  _id: Types.ObjectId;
  name: string;
  percent: number;
  createdAt: Date;
  updatedAt: Date;
}

const vatRateSchema = new Schema<VatRateDoc>(
  {
    name: { type: String, required: true },
    percent: { type: Number, required: true },
  },
  { timestamps: true },
);
vatRateSchema.plugin(tenantGuard);
vatRateSchema.index({ tenantId: 1, name: 1 });

export const VatRateModel: Model<VatRateDoc> =
  (mongoose.models.VatRate as Model<VatRateDoc> | undefined) ??
  mongoose.model<VatRateDoc>('VatRate', vatRateSchema);

export function toVatRate(doc: VatRateDoc): VatRate {
  return {
    id: doc._id.toString() as VatRate['id'],
    tenantId: doc.tenantId as VatRate['tenantId'],
    name: doc.name,
    percent: doc.percent,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class VatRateRepository {
  constructor(private readonly model: Model<VatRateDoc> = VatRateModel) {}

  async create(input: { name: string; percent: number }): Promise<VatRate> {
    const created = await this.model.create({ name: input.name, percent: input.percent });
    return toVatRate(created.toObject() as unknown as VatRateDoc);
  }

  async findById(id: string): Promise<VatRate | null> {
    const doc = await this.model.findById(id).lean<VatRateDoc>().exec();
    return doc ? toVatRate(doc) : null;
  }

  async list(): Promise<VatRate[]> {
    const docs = await this.model.find({}).sort({ name: 1 }).lean<VatRateDoc[]>().exec();
    return docs.map(toVatRate);
  }

  async update(id: string, patch: { name?: string; percent?: number }): Promise<VatRate | null> {
    const out: Record<string, unknown> = {};
    if (patch.name !== undefined) out.name = patch.name;
    if (patch.percent !== undefined) out.percent = patch.percent;
    const doc = await this.model
      .findByIdAndUpdate(id, out, { returnDocument: 'after' })
      .lean<VatRateDoc>()
      .exec();
    return doc ? toVatRate(doc) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: String(id) }).exec();
    return (res.deletedCount ?? 0) > 0;
  }
}

// ── Plan ─────────────────────────────────────────────────────────────────────--
export interface PlanDoc extends TenantScoped {
  _id: Types.ObjectId;
  name: string;
  type: PlanType;
  price: { amountMinor: number; currency: string };
  interval: BillingInterval;
  vatRateId: string | null;
  classPackCredits: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<PlanDoc>(
  {
    name: { type: String, required: true },
    type: { type: String, required: true },
    price: { type: moneySchema, required: true },
    interval: { type: String, required: true, default: 'monthly' },
    vatRateId: { type: String, default: null },
    classPackCredits: { type: Number, default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);
planSchema.plugin(tenantGuard);
// Hot list query: active plans within a tenant.
planSchema.index({ tenantId: 1, active: 1 });

export const PlanModel: Model<PlanDoc> =
  (mongoose.models.Plan as Model<PlanDoc> | undefined) ??
  mongoose.model<PlanDoc>('Plan', planSchema);

export function toPlan(doc: PlanDoc): Plan {
  return {
    id: doc._id.toString() as Plan['id'],
    tenantId: doc.tenantId as Plan['tenantId'],
    name: doc.name,
    type: doc.type,
    price: toMoney(doc.price),
    interval: doc.interval,
    vatRateId: (doc.vatRateId as Plan['vatRateId']) ?? null,
    classPackCredits: doc.classPackCredits ?? null,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class PlanRepository {
  constructor(private readonly model: Model<PlanDoc> = PlanModel) {}

  async create(input: {
    name: string;
    type: PlanType;
    price: Money;
    interval: BillingInterval;
    vatRateId?: string | null;
    classPackCredits?: number | null;
    active?: boolean;
  }): Promise<Plan> {
    const created = await this.model.create({
      name: input.name,
      type: input.type,
      price: { amountMinor: input.price.amountMinor, currency: input.price.currency },
      interval: input.interval,
      vatRateId: input.vatRateId ?? null,
      classPackCredits: input.classPackCredits ?? null,
      active: input.active ?? true,
    });
    return toPlan(created.toObject() as unknown as PlanDoc);
  }

  async findById(id: string): Promise<Plan | null> {
    const doc = await this.model.findById(id).lean<PlanDoc>().exec();
    return doc ? toPlan(doc) : null;
  }

  async list(opts: { active?: boolean } = {}): Promise<Plan[]> {
    const filter = opts.active !== undefined ? { active: opts.active } : {};
    const docs = await this.model.find(filter).sort({ name: 1 }).lean<PlanDoc[]>().exec();
    return docs.map(toPlan);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      type?: PlanType;
      price?: Money;
      interval?: BillingInterval;
      vatRateId?: string | null;
      classPackCredits?: number | null;
      active?: boolean;
    },
  ): Promise<Plan | null> {
    const out: Record<string, unknown> = {};
    if (patch.name !== undefined) out.name = patch.name;
    if (patch.type !== undefined) out.type = patch.type;
    if (patch.price !== undefined)
      out.price = { amountMinor: patch.price.amountMinor, currency: patch.price.currency };
    if (patch.interval !== undefined) out.interval = patch.interval;
    if (patch.vatRateId !== undefined) out.vatRateId = patch.vatRateId;
    if (patch.classPackCredits !== undefined) out.classPackCredits = patch.classPackCredits;
    if (patch.active !== undefined) out.active = patch.active;
    const doc = await this.model
      .findByIdAndUpdate(id, out, { returnDocument: 'after' })
      .lean<PlanDoc>()
      .exec();
    return doc ? toPlan(doc) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: String(id) }).exec();
    return (res.deletedCount ?? 0) > 0;
  }
}

// ── Enrollment ───────────────────────────────────────────────────────────────--
export interface EnrollmentDoc extends TenantScoped {
  _id: Types.ObjectId;
  memberId: string;
  planId: string;
  status: EnrollmentStatus;
  startDate: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  freezeFrom: string | null;
  freezeUntil: string | null;
  cancelAt: string | null;
  mandateRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const enrollmentSchema = new Schema<EnrollmentDoc>(
  {
    memberId: { type: String, required: true },
    planId: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' },
    startDate: { type: String, required: true },
    currentPeriodStart: { type: String, default: null },
    currentPeriodEnd: { type: String, default: null },
    freezeFrom: { type: String, default: null },
    freezeUntil: { type: String, default: null },
    cancelAt: { type: String, default: null },
    mandateRef: { type: String, default: null },
  },
  { timestamps: true },
);
enrollmentSchema.plugin(tenantGuard);
// Hot query: a member's enrollments within a tenant.
enrollmentSchema.index({ tenantId: 1, memberId: 1 });

export const EnrollmentModel: Model<EnrollmentDoc> =
  (mongoose.models.Enrollment as Model<EnrollmentDoc> | undefined) ??
  mongoose.model<EnrollmentDoc>('Enrollment', enrollmentSchema);

export function toEnrollment(doc: EnrollmentDoc): Enrollment {
  return {
    id: doc._id.toString() as Enrollment['id'],
    tenantId: doc.tenantId as Enrollment['tenantId'],
    memberId: doc.memberId as Enrollment['memberId'],
    planId: doc.planId as Enrollment['planId'],
    status: doc.status,
    startDate: doc.startDate,
    currentPeriodStart: doc.currentPeriodStart,
    currentPeriodEnd: doc.currentPeriodEnd,
    freezeFrom: doc.freezeFrom,
    freezeUntil: doc.freezeUntil,
    cancelAt: doc.cancelAt,
    mandateRef: doc.mandateRef,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class EnrollmentRepository {
  constructor(private readonly model: Model<EnrollmentDoc> = EnrollmentModel) {}

  async create(input: {
    memberId: string;
    planId: string;
    startDate: string;
    status?: EnrollmentStatus;
  }): Promise<Enrollment> {
    const created = await this.model.create({
      memberId: input.memberId,
      planId: input.planId,
      startDate: input.startDate,
      status: input.status ?? 'pending',
    });
    return toEnrollment(created.toObject() as unknown as EnrollmentDoc);
  }

  async findById(id: string): Promise<Enrollment | null> {
    const doc = await this.model.findById(id).lean<EnrollmentDoc>().exec();
    return doc ? toEnrollment(doc) : null;
  }

  async list(opts: { memberId?: string } = {}): Promise<Enrollment[]> {
    const filter = opts.memberId ? { memberId: String(opts.memberId) } : {};
    const docs = await this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .lean<EnrollmentDoc[]>()
      .exec();
    return docs.map(toEnrollment);
  }

  /**
   * ACTIVE enrollments that may be due for billing as of `asOf` (a `YYYY-MM-DD`): already started
   * (startDate <= asOf) and either never billed (currentPeriodEnd null) or whose period has ended
   * (currentPeriodEnd <= asOf). This is a coarse candidate filter — the billing service applies the
   * precise per-plan period/interval logic (`computeBillingPeriod`) and skips non-recurring plans.
   * Frozen/cancelled/pending enrollments are excluded.
   */
  async listDueForBilling(asOf: string): Promise<Enrollment[]> {
    const docs = await this.model
      .find({
        status: 'active',
        startDate: { $lte: asOf },
        $or: [{ currentPeriodEnd: null }, { currentPeriodEnd: { $lte: asOf } }],
      })
      .sort({ startDate: 1 })
      .lean<EnrollmentDoc[]>()
      .exec();
    return docs.map(toEnrollment);
  }

  async update(
    id: string,
    patch: {
      status?: EnrollmentStatus;
      currentPeriodStart?: string | null;
      currentPeriodEnd?: string | null;
      freezeFrom?: string | null;
      freezeUntil?: string | null;
      cancelAt?: string | null;
      mandateRef?: string | null;
    },
  ): Promise<Enrollment | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { returnDocument: 'after' })
      .lean<EnrollmentDoc>()
      .exec();
    return doc ? toEnrollment(doc) : null;
  }
}

// ── Invoice ──────────────────────────────────────────────────────────────────--
const invoiceLineSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitAmount: { type: moneySchema, required: true },
    vatPercent: { type: Number, required: true },
    vatAmount: { type: moneySchema, required: true },
    lineTotal: { type: moneySchema, required: true },
  },
  { _id: false },
);

export interface InvoiceLineDoc {
  description: string;
  quantity: number;
  unitAmount: { amountMinor: number; currency: string };
  vatPercent: number;
  vatAmount: { amountMinor: number; currency: string };
  lineTotal: { amountMinor: number; currency: string };
}

export interface InvoiceDoc extends TenantScoped {
  _id: Types.ObjectId;
  number: string | null;
  memberId: string;
  householdId: string | null;
  enrollmentId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  status: InvoiceStatus;
  currency: string;
  lines: InvoiceLineDoc[];
  subtotal: { amountMinor: number; currency: string };
  vatTotal: { amountMinor: number; currency: string };
  total: { amountMinor: number; currency: string };
  reverseCharge: boolean;
  sellerVatId: string | null;
  buyerVatId: string | null;
  issuedAt: string | null;
  dueAt: string | null;
  paidAt: string | null;
  dunningStage: number;
  nextRetryAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<InvoiceDoc>(
  {
    number: { type: String, default: null },
    memberId: { type: String, required: true },
    householdId: { type: String, default: null },
    enrollmentId: { type: String, default: null },
    periodStart: { type: String, default: null },
    periodEnd: { type: String, default: null },
    status: { type: String, required: true, default: 'draft' },
    currency: { type: String, required: true },
    lines: { type: [invoiceLineSchema], required: true, default: [] },
    subtotal: { type: moneySchema, required: true },
    vatTotal: { type: moneySchema, required: true },
    total: { type: moneySchema, required: true },
    reverseCharge: { type: Boolean, required: true, default: false },
    sellerVatId: { type: String, default: null },
    buyerVatId: { type: String, default: null },
    issuedAt: { type: String, default: null },
    dueAt: { type: String, default: null },
    paidAt: { type: String, default: null },
    dunningStage: { type: Number, required: true, default: 0 },
    nextRetryAt: { type: String, default: null },
  },
  { timestamps: true },
);
invoiceSchema.plugin(tenantGuard);
// Gapless invoice numbers must be unique per tenant. Drafts have `number: null`, so the index is
// sparse (a partial filter on a present string) — null numbers never collide.
invoiceSchema.index(
  { tenantId: 1, number: 1 },
  { unique: true, partialFilterExpression: { number: { $type: 'string' } } },
);
// Hot list query: invoices for a member within a tenant.
invoiceSchema.index({ tenantId: 1, memberId: 1 });
// Recurring-billing idempotency: AT MOST ONE invoice per (tenant, enrollment, periodStart). The
// partial filter scopes the uniqueness to subscription invoices (enrollmentId is a string); ad-hoc
// invoices (enrollmentId: null) are unconstrained. This is the DB-level guarantee that a re-run of
// billing-run can never double-bill the same period, even under concurrency (ADR-0013).
invoiceSchema.index(
  { tenantId: 1, enrollmentId: 1, periodStart: 1 },
  { unique: true, partialFilterExpression: { enrollmentId: { $type: 'string' } } },
);
// Dunning sweep: open invoices ordered for the worker to walk.
invoiceSchema.index({ tenantId: 1, status: 1, dueAt: 1 });

export const InvoiceModel: Model<InvoiceDoc> =
  (mongoose.models.Invoice as Model<InvoiceDoc> | undefined) ??
  mongoose.model<InvoiceDoc>('Invoice', invoiceSchema);

function toInvoiceLine(doc: InvoiceLineDoc): InvoiceLine {
  return {
    description: doc.description,
    quantity: doc.quantity,
    unitAmount: toMoney(doc.unitAmount),
    vatPercent: doc.vatPercent,
    vatAmount: toMoney(doc.vatAmount),
    lineTotal: toMoney(doc.lineTotal),
  };
}

export function toInvoice(doc: InvoiceDoc): Invoice {
  return {
    id: doc._id.toString() as Invoice['id'],
    tenantId: doc.tenantId as Invoice['tenantId'],
    number: doc.number,
    memberId: doc.memberId as Invoice['memberId'],
    householdId: (doc.householdId as Invoice['householdId']) ?? null,
    enrollmentId: (doc.enrollmentId as Invoice['enrollmentId']) ?? null,
    periodStart: doc.periodStart,
    periodEnd: doc.periodEnd,
    status: doc.status,
    currency: doc.currency as Currency,
    lines: doc.lines.map(toInvoiceLine),
    subtotal: toMoney(doc.subtotal),
    vatTotal: toMoney(doc.vatTotal),
    total: toMoney(doc.total),
    reverseCharge: doc.reverseCharge,
    sellerVatId: doc.sellerVatId,
    buyerVatId: doc.buyerVatId,
    issuedAt: doc.issuedAt,
    dueAt: doc.dueAt,
    paidAt: doc.paidAt,
    dunningStage: doc.dunningStage,
    nextRetryAt: doc.nextRetryAt,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function moneyFields(m: Money): { amountMinor: number; currency: string } {
  return { amountMinor: m.amountMinor, currency: m.currency };
}

function lineFields(l: InvoiceLine): InvoiceLineDoc {
  return {
    description: l.description,
    quantity: l.quantity,
    unitAmount: moneyFields(l.unitAmount),
    vatPercent: l.vatPercent,
    vatAmount: moneyFields(l.vatAmount),
    lineTotal: moneyFields(l.lineTotal),
  };
}

export interface InvoiceCreateFields {
  memberId: string;
  householdId?: string | null;
  enrollmentId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  status?: InvoiceStatus;
  currency: Currency;
  lines: readonly InvoiceLine[];
  subtotal: Money;
  vatTotal: Money;
  total: Money;
  reverseCharge?: boolean;
  sellerVatId?: string | null;
  buyerVatId?: string | null;
  dueAt?: string | null;
}

/** Raised when an invoice already exists for an (enrollment, periodStart) — the idempotency guard. */
export class DuplicateInvoicePeriodError extends Error {
  constructor(enrollmentId: string, periodStart: string) {
    super(`invoice already exists for enrollment ${enrollmentId} period ${periodStart}`);
    this.name = 'DuplicateInvoicePeriodError';
  }
}

/** Raised when an issued invoice's immutable fields would be changed (ADR-0007/0013 legal retention). */
export class InvoiceImmutableError extends Error {
  constructor(detail: string) {
    super(`invoice is immutable once issued: ${detail}`);
    this.name = 'InvoiceImmutableError';
  }
}

export class InvoiceRepository {
  constructor(private readonly model: Model<InvoiceDoc> = InvoiceModel) {}

  async create(input: InvoiceCreateFields): Promise<Invoice> {
    try {
      const created = await this.model.create({
        number: null,
        memberId: input.memberId,
        householdId: input.householdId ?? null,
        enrollmentId: input.enrollmentId ?? null,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
        status: input.status ?? 'draft',
        currency: input.currency,
        lines: input.lines.map(lineFields),
        subtotal: moneyFields(input.subtotal),
        vatTotal: moneyFields(input.vatTotal),
        total: moneyFields(input.total),
        reverseCharge: input.reverseCharge ?? false,
        sellerVatId: input.sellerVatId ?? null,
        buyerVatId: input.buyerVatId ?? null,
        dueAt: input.dueAt ?? null,
      });
      return toInvoice(created.toObject() as unknown as InvoiceDoc);
    } catch (err) {
      // The {tenant, enrollment, periodStart} unique index rejected a concurrent double-bill — make
      // it a typed, catchable signal so the billing service can resume/skip idempotently.
      if (
        input.enrollmentId != null &&
        input.periodStart != null &&
        (err as { code?: number }).code === 11000
      ) {
        throw new DuplicateInvoicePeriodError(input.enrollmentId, input.periodStart);
      }
      throw err;
    }
  }

  /** Resume/idempotency lookup: the invoice (if any) for an enrollment's billing period. */
  async findByEnrollmentPeriod(enrollmentId: string, periodStart: string): Promise<Invoice | null> {
    const doc = await this.model
      .findOne({ enrollmentId: String(enrollmentId), periodStart: String(periodStart) })
      .lean<InvoiceDoc>()
      .exec();
    return doc ? toInvoice(doc) : null;
  }

  /**
   * Invoices eligible for a dunning step as of `nowIso`: OPEN, past due, and either never retried or
   * past their `nextRetryAt`. Oldest-due first. The retry-window filter makes the dunning sweep
   * idempotent against re-delivered jobs (a duplicate run before nextRetryAt selects nothing).
   */
  async listDunnable(nowIso: string): Promise<Invoice[]> {
    const docs = await this.model
      .find({
        status: 'open',
        dueAt: { $ne: null, $lt: nowIso },
        $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: nowIso } }],
      })
      .sort({ dueAt: 1 })
      .lean<InvoiceDoc[]>()
      .exec();
    return docs.map(toInvoice);
  }

  async findById(id: string): Promise<Invoice | null> {
    const doc = await this.model.findById(id).lean<InvoiceDoc>().exec();
    return doc ? toInvoice(doc) : null;
  }

  async list(opts: { memberId?: string; status?: InvoiceStatus } = {}): Promise<Invoice[]> {
    const filter: Record<string, unknown> = {};
    if (opts.memberId) filter.memberId = String(opts.memberId);
    if (opts.status) filter.status = String(opts.status);
    const docs = await this.model.find(filter).sort({ createdAt: -1 }).lean<InvoiceDoc[]>().exec();
    return docs.map(toInvoice);
  }

  /**
   * Atomically issue a DRAFT invoice: flip draft → open AND stamp issuedAt/dueAt AND set the gapless
   * `number` — all in ONE document write. Returns the issued invoice, or null if it was not a draft
   * (already issued / not found). The pre-allocated `number` is set here rather than in a second
   * write so there is NEVER a persisted "open invoice without a number" — the legally-invalid state
   * the old claim-then-assign ordering could leave on a crash (audit H4). The {status:'draft'} guard
   * is the concurrency guard: only ONE caller wins, so the transition (and the number) is applied at
   * most once per invoice. A duplicate `number` within a tenant is rejected by the {tenantId, number}
   * unique index (the hard backstop), surfacing as a write error rather than a silent collision.
   * ADR-0013.
   */
  async claimForIssueWithNumber(
    id: string,
    opts: { issuedAt: string; dueAt: string; number: string },
  ): Promise<Invoice | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: String(id), status: 'draft' },
        {
          $set: { status: 'open', issuedAt: opts.issuedAt, dueAt: opts.dueAt, number: opts.number },
        },
        { returnDocument: 'after' },
      )
      .lean<InvoiceDoc>()
      .exec();
    return doc ? toInvoice(doc) : null;
  }

  /**
   * Atomically apply a dunning step: write `patch` ONLY if the invoice is still OPEN at the expected
   * `fromStage`. Returns the updated invoice, or null if a concurrent/re-delivered worker already
   * advanced it (the {status:'open', dunningStage} precondition no longer matches). This is what
   * makes the dunning ladder idempotent under concurrency — at most one caller wins each rung
   * (ADR-0013).
   */
  async advanceDunningStep(
    id: string,
    fromStage: number,
    patch: { status?: InvoiceStatus; dunningStage: number; nextRetryAt: string | null },
  ): Promise<Invoice | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: String(id), status: 'open', dunningStage: fromStage },
        { $set: patch },
        { returnDocument: 'after' },
      )
      .lean<InvoiceDoc>()
      .exec();
    return doc ? toInvoice(doc) : null;
  }

  /**
   * Post-issue lifecycle transitions only (paid / uncollectible / dunning fields). The invoice
   * NUMBER is never set here (it is set once, atomically, by `claimForIssueWithNumber`), and
   * reverting to `draft` is rejected — issued invoices are immutable for legal retention
   * (ADR-0007/0013). Lines/totals are not in the patch
   * surface at all, so they can never be mutated post-creation.
   */
  async update(
    id: string,
    patch: {
      status?: InvoiceStatus;
      issuedAt?: string | null;
      dueAt?: string | null;
      paidAt?: string | null;
      dunningStage?: number;
      nextRetryAt?: string | null;
    },
  ): Promise<Invoice | null> {
    if (patch.status === 'draft') {
      throw new InvoiceImmutableError('cannot revert an issued invoice to draft');
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { returnDocument: 'after' })
      .lean<InvoiceDoc>()
      .exec();
    return doc ? toInvoice(doc) : null;
  }
}

// ── InvoiceCounter (gapless per-tenant numbering) ──────────────────────────────-
/**
 * One counter document PER (tenant, year) — see the compound-unique index below.
 * `allocateInvoiceNumber` bumps `seq` atomically with `findOneAndUpdate({ $inc })` so concurrent
 * issues within a tenant-year get 1,2,3,… with NO gaps; the sequence resets each year and two
 * tenants' sequences are fully independent. Deliberately NOT tenant-guarded: numbering must be
 * reachable during the issue path with a plain, explicit `{ tenantId, year }` filter, and we never
 * want the guard rewriting the upsert's `$setOnInsert`.
 */
export interface InvoiceCounterDoc {
  _id: Types.ObjectId;
  tenantId: string;
  year: number;
  seq: number;
}

const invoiceCounterSchema = new Schema<InvoiceCounterDoc>({
  tenantId: { type: String, required: true },
  year: { type: Number, required: true },
  seq: { type: Number, required: true, default: 0 },
});
// One counter PER (tenant, year): the sequence resets each year and the printed year always
// matches the issue year (ADR-0013). Compound-unique so two years/tenants never share a counter.
invoiceCounterSchema.index({ tenantId: 1, year: 1 }, { unique: true });

export const InvoiceCounterModel: Model<InvoiceCounterDoc> =
  (mongoose.models.InvoiceCounter as Model<InvoiceCounterDoc> | undefined) ??
  mongoose.model<InvoiceCounterDoc>('InvoiceCounter', invoiceCounterSchema);

/** The invoice number prefix (ADR-0013: `{prefix}{year}-{seq}`, configurable; default OBK). */
const INVOICE_NUMBER_PREFIX = 'OBK';

/** Zero-pad the sequence to 6 digits, e.g. 123 → `000123`. */
function formatInvoiceNumber(year: number, seq: number): string {
  return `${INVOICE_NUMBER_PREFIX}-${year}-${String(seq).padStart(6, '0')}`;
}

export class InvoiceCounterRepository {
  constructor(private readonly model: Model<InvoiceCounterDoc> = InvoiceCounterModel) {}

  /**
   * Allocate the next gapless, sequential invoice number for `tenantId` in `year`. The atomic
   * `$inc` upsert means concurrent callers within a tenant each get a distinct, contiguous seq
   * (1,2,3,…) and two tenants never collide. Format: `OBK-2026-000123`.
   */
  async allocateInvoiceNumber(tenantId: string, year: number): Promise<string> {
    const doc = await this.model
      .findOneAndUpdate(
        { tenantId: String(tenantId), year },
        { $inc: { seq: 1 }, $setOnInsert: { tenantId, year } },
        { upsert: true, returnDocument: 'after' },
      )
      .lean<InvoiceCounterDoc>()
      .exec();
    if (doc === null) throw new Error('failed to allocate invoice number');
    // Format from the requested year (== doc.year, since the counter is keyed per year).
    return formatInvoiceNumber(year, doc.seq);
  }
}

// ── PaymentAttempt ───────────────────────────────────────────────────────────--
export interface PaymentAttemptDoc extends TenantScoped {
  _id: Types.ObjectId;
  invoiceId: string;
  provider: string;
  providerChargeRef: string | null;
  amount: { amountMinor: number; currency: string };
  status: PaymentAttemptStatus;
  idempotencyKey: string;
  attemptNo: number;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentAttemptSchema = new Schema<PaymentAttemptDoc>(
  {
    invoiceId: { type: String, required: true },
    provider: { type: String, required: true, default: 'manual' },
    providerChargeRef: { type: String, default: null },
    amount: { type: moneySchema, required: true },
    status: { type: String, required: true, default: 'pending' },
    idempotencyKey: { type: String, required: true },
    attemptNo: { type: Number, required: true, default: 1 },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);
paymentAttemptSchema.plugin(tenantGuard);
// Idempotency is per-tenant: the same key may not be replayed within a tenant.
paymentAttemptSchema.index(...tenantUniqueIndex({ idempotencyKey: 1 }));
// Hot query: a invoice's attempts within a tenant.
paymentAttemptSchema.index({ tenantId: 1, invoiceId: 1 });

export const PaymentAttemptModel: Model<PaymentAttemptDoc> =
  (mongoose.models.PaymentAttempt as Model<PaymentAttemptDoc> | undefined) ??
  mongoose.model<PaymentAttemptDoc>('PaymentAttempt', paymentAttemptSchema);

export function toPaymentAttempt(doc: PaymentAttemptDoc): PaymentAttempt {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId as PaymentAttempt['tenantId'],
    invoiceId: doc.invoiceId as PaymentAttempt['invoiceId'],
    provider: doc.provider,
    providerChargeRef: doc.providerChargeRef,
    amount: toMoney(doc.amount),
    status: doc.status,
    idempotencyKey: doc.idempotencyKey,
    attemptNo: doc.attemptNo,
    failureReason: doc.failureReason,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class PaymentAttemptRepository {
  constructor(private readonly model: Model<PaymentAttemptDoc> = PaymentAttemptModel) {}

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
    const created = await this.model.create({
      invoiceId: input.invoiceId,
      provider: input.provider ?? 'manual',
      providerChargeRef: input.providerChargeRef ?? null,
      amount: moneyFields(input.amount),
      status: input.status ?? 'pending',
      idempotencyKey: input.idempotencyKey,
      attemptNo: input.attemptNo ?? 1,
      failureReason: input.failureReason ?? null,
    });
    return toPaymentAttempt(created.toObject() as unknown as PaymentAttemptDoc);
  }

  async listByInvoice(invoiceId: string): Promise<PaymentAttempt[]> {
    const docs = await this.model
      .find({ invoiceId: String(invoiceId) })
      .sort({ attemptNo: 1 })
      .lean<PaymentAttemptDoc[]>()
      .exec();
    return docs.map(toPaymentAttempt);
  }
}
