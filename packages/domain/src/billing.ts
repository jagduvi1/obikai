import { z } from 'zod';
import type {
  EnrollmentId,
  HouseholdId,
  InvoiceId,
  MemberId,
  PlanId,
  TenantId,
  VatRateId,
} from './ids.js';
import { type Currency, type Money, money } from './money.js';

/**
 * Memberships & billing model (ADR-0011/0013). The §7 separations are explicit: Plan (template) ≠
 * Enrollment (this member on this plan) ≠ Invoice (a generated bill) ≠ PaymentAttempt. All money is
 * integer minor units (`Money`). The pure VAT/total/proration helpers below are the §11 rigor area
 * and are property-tested.
 */

// ── VAT ───────────────────────────────────────────────────────────────────────
export interface VatRate {
  readonly id: VatRateId;
  readonly tenantId: TenantId;
  readonly name: string;
  /** Percentage, e.g. 25, 12, 6, 0. */
  readonly percent: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Compute the VAT owed on a net amount, rounded to the minor unit (half away from zero). */
export function computeVat(net: Money, percent: number): Money {
  const raw = (net.amountMinor * percent) / 100;
  const rounded = raw >= 0 ? Math.floor(raw + 0.5) : Math.ceil(raw - 0.5);
  return money(rounded, net.currency);
}

// ── Plans ───────────────────────────────────────────────────────────────────--
export const PLAN_TYPES = ['recurring', 'term', 'class_pack', 'drop_in', 'family'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const BILLING_INTERVALS = ['monthly', 'quarterly', 'yearly', 'none'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export interface Plan {
  readonly id: PlanId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly type: PlanType;
  readonly price: Money;
  readonly interval: BillingInterval;
  readonly vatRateId: VatRateId | null;
  /** For class_pack plans: number of class credits granted. */
  readonly classPackCredits: number | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Enrollments (subscriptions) ────────────────────────────────────────────────
export const ENROLLMENT_STATUSES = ['pending', 'active', 'frozen', 'cancelled'] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export interface Enrollment {
  readonly id: EnrollmentId;
  readonly tenantId: TenantId;
  readonly memberId: MemberId;
  readonly planId: PlanId;
  readonly status: EnrollmentStatus;
  readonly startDate: string;
  readonly currentPeriodStart: string | null;
  readonly currentPeriodEnd: string | null;
  readonly freezeFrom: string | null;
  readonly freezeUntil: string | null;
  readonly cancelAt: string | null;
  /** Opaque payment-provider mandate id authorizing recurring debit (ADR-0006), or null. */
  readonly mandateRef: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Invoices ───────────────────────────────────────────────────────────────────
export const INVOICE_STATUSES = ['draft', 'open', 'paid', 'void', 'uncollectible'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface InvoiceLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitAmount: Money;
  readonly vatPercent: number;
  readonly vatAmount: Money;
  readonly lineTotal: Money;
}

export interface Invoice {
  readonly id: InvoiceId;
  readonly tenantId: TenantId;
  /** Sequential, gapless per tenant — assigned only when the invoice is issued (ADR-0013). */
  readonly number: string | null;
  readonly memberId: MemberId;
  readonly householdId: HouseholdId | null;
  /**
   * The enrollment this invoice bills, for recurring subscriptions — null for ad-hoc/manual
   * invoices. Together with `periodStart` it is the idempotency key for automated billing: the DB
   * enforces at most one invoice per (tenant, enrollment, periodStart), so a re-run never double-bills.
   */
  readonly enrollmentId: EnrollmentId | null;
  /** Service period this invoice covers (ISO date), for recurring billing; null for ad-hoc. */
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly status: InvoiceStatus;
  readonly currency: Currency;
  readonly lines: readonly InvoiceLine[];
  readonly subtotal: Money;
  readonly vatTotal: Money;
  readonly total: Money;
  /** True for intra-EU B2B reverse charge (no VAT charged; note printed). */
  readonly reverseCharge: boolean;
  readonly sellerVatId: string | null;
  readonly buyerVatId: string | null;
  readonly issuedAt: string | null;
  readonly dueAt: string | null;
  readonly paidAt: string | null;
  /** Dunning ladder position (0 = not in dunning). */
  readonly dunningStage: number;
  readonly nextRetryAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Build a VAT-correct invoice line from a unit price + quantity + VAT percent (reverse charge ⇒ 0). */
export function buildInvoiceLine(
  description: string,
  quantity: number,
  unitAmount: Money,
  vatPercent: number,
  reverseCharge = false,
): InvoiceLine {
  const net = money(unitAmount.amountMinor * quantity, unitAmount.currency);
  const effectivePercent = reverseCharge ? 0 : vatPercent;
  const vatAmount = computeVat(net, effectivePercent);
  return {
    description,
    quantity,
    unitAmount,
    vatPercent: effectivePercent,
    vatAmount,
    lineTotal: money(net.amountMinor + vatAmount.amountMinor, net.currency),
  };
}

/** Sum lines into {subtotal (net), vatTotal, total}. Throws on a currency mismatch. */
export function invoiceTotals(
  lines: readonly InvoiceLine[],
  currency: Currency,
): {
  subtotal: Money;
  vatTotal: Money;
  total: Money;
} {
  let net = 0;
  let vat = 0;
  for (const l of lines) {
    if (l.unitAmount.currency !== currency || l.vatAmount.currency !== currency) {
      throw new Error('invoice line currency mismatch');
    }
    net += l.unitAmount.amountMinor * l.quantity;
    vat += l.vatAmount.amountMinor;
  }
  return {
    subtotal: money(net, currency),
    vatTotal: money(vat, currency),
    total: money(net + vat, currency),
  };
}

/**
 * Prorate an amount by days (mid-cycle plan change/freeze). Returns the portion owed for
 * `remainingDays` of `totalDays`, rounded to the minor unit. Conservation: prorate(x,n,k) +
 * prorate(x,n,n-k) === x for 0<=k<=n (property-tested).
 */
export function prorateByDays(amount: Money, totalDays: number, remainingDays: number): Money {
  if (totalDays <= 0) return money(0, amount.currency);
  const clamped = Math.max(0, Math.min(remainingDays, totalDays));
  const raw = (amount.amountMinor * clamped) / totalDays;
  // Half away from zero, matching computeVat — symmetric for credits/refunds (negative amounts).
  const portion = raw >= 0 ? Math.floor(raw + 0.5) : Math.ceil(raw - 0.5);
  return money(portion, amount.currency);
}

// ── Recurring billing periods ──────────────────────────────────────────────────
/** Months advanced per billing interval (0 for the non-recurring 'none'). */
export function intervalMonths(interval: BillingInterval): number {
  switch (interval) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'yearly':
      return 12;
    case 'none':
      return 0;
  }
}

/**
 * Add `months` to a `YYYY-MM-DD` date in UTC, clamping the day to the target month's last day
 * (e.g. 2026-01-31 + 1 month → 2026-02-28). Pure/deterministic — no ambient clock.
 */
export function addMonthsUTC(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  // Anchor on the 1st so setUTCMonth never rolls over a short month, then clamp the day.
  const base = new Date(Date.UTC(y, m - 1 + months, 1));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth(); // 0-based
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export interface BillingPeriod {
  /** Inclusive period start, `YYYY-MM-DD`. */
  readonly periodStart: string;
  /** Exclusive period end (== the next period's start), `YYYY-MM-DD`. */
  readonly periodEnd: string;
}

/**
 * The next billing period to invoice for a recurring enrollment, or null if none is due as of
 * `asOf` (a `YYYY-MM-DD`). The next period starts where the last ended (`currentPeriodEnd`), or at
 * `startDate` for the first invoice. Bills in advance: a period is due once it has started
 * (`periodStart <= asOf`). Returns null for non-recurring intervals ('none'). One period per call;
 * successive runs catch up a lapsed enrollment.
 */
export function computeBillingPeriod(
  interval: BillingInterval,
  startDate: string,
  currentPeriodEnd: string | null,
  asOf: string,
): BillingPeriod | null {
  if (intervalMonths(interval) === 0) return null;
  const periodStart = currentPeriodEnd ?? startDate;
  if (periodStart > asOf) return null; // period hasn't started yet → nothing due
  return { periodStart, periodEnd: addMonthsUTC(periodStart, intervalMonths(interval)) };
}

// ── Payment attempts ───────────────────────────────────────────────────────────
export const PAYMENT_ATTEMPT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'refunded',
] as const;
export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export interface PaymentAttempt {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly invoiceId: InvoiceId;
  readonly provider: string;
  readonly providerChargeRef: string | null;
  readonly amount: Money;
  readonly status: PaymentAttemptStatus;
  readonly idempotencyKey: string;
  readonly attemptNo: number;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Zod create inputs (API DTOs) ───────────────────────────────────────────────
const currencyEnum = z.enum(['SEK', 'NOK', 'DKK', 'EUR']);

export const planCreateSchema = z.object({
  name: z.string().min(1),
  type: z.enum(PLAN_TYPES),
  priceMinor: z.number().int().nonnegative(),
  currency: currencyEnum,
  interval: z.enum(BILLING_INTERVALS).default('monthly'),
  vatRateId: z.string().min(1).nullable().optional(),
  classPackCredits: z.number().int().positive().nullable().optional(),
  active: z.boolean().default(true),
});
export type PlanCreateInput = z.infer<typeof planCreateSchema>;

export const enrollmentCreateSchema = z.object({
  memberId: z.string().min(1),
  planId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type EnrollmentCreateInput = z.infer<typeof enrollmentCreateSchema>;

export const vatRateCreateSchema = z.object({
  name: z.string().min(1),
  percent: z.number().min(0).max(100),
});
export type VatRateCreateInput = z.infer<typeof vatRateCreateSchema>;
