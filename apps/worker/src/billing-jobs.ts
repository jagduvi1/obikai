import { type AuthzActor, systemActor } from '@obikai/authz';
import { BillingService } from '@obikai/billing';
import {
  EnrollmentRepository,
  InvoiceCounterRepository,
  InvoiceRepository,
  PaymentAttemptRepository,
  PlanRepository,
  VatRateRepository,
} from '@obikai/db';
import type { Enrollment, Invoice } from '@obikai/domain';

/**
 * The billing-run and dunning job orchestrators (ADR-0013). They run INSIDE an already-open tenant
 * context (the worker opens it per job, ADR-0004), so the @obikai/db repositories they use are
 * automatically tenant-scoped — these functions never see other tenants. The heavy lifting lives in
 * the framework-free `BillingService` (shared with the api); these only sweep the tenant's due work
 * and isolate per-item failures so one bad record can't abort the whole run. Both are idempotent at
 * the service layer, so a re-delivered job never double-bills or double-advances.
 */

/** Narrow capability surfaces so the orchestrators unit-test against light fakes. */
export interface RecurringBiller {
  billRecurringForEnrollment(actor: AuthzActor, enrollmentId: string): Promise<Invoice | null>;
}
export interface DunningAdvancer {
  advanceDunning(actor: AuthzActor, invoiceId: string): Promise<Invoice>;
}
export interface DueEnrollmentSource {
  listDueForBilling(asOf: string): Promise<Enrollment[]>;
}
export interface DunnableInvoiceSource {
  listDunnable(nowIso: string): Promise<Invoice[]>;
}
export type JobLog = (msg: string, meta?: Record<string, unknown>) => void;

export interface BillingRunResult {
  considered: number;
  issued: number;
  failed: number;
}
export interface DunningRunResult {
  considered: number;
  advanced: number;
  failed: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * billing-run: issue the next due recurring invoice for every active enrollment in the CURRENT
 * tenant. Per-enrollment isolation — a single bad enrollment (or a duplicate-period race from a
 * concurrent run) is logged and skipped, never aborting the sweep. `billRecurringForEnrollment` is
 * idempotent, so a re-delivered job never double-bills.
 */
export async function runBillingForTenant(
  biller: RecurringBiller,
  enrollments: DueEnrollmentSource,
  now: () => Date,
  log: JobLog,
): Promise<BillingRunResult> {
  const asOf = now().toISOString().slice(0, 10); // YYYY-MM-DD
  const due = await enrollments.listDueForBilling(asOf);
  const actor = systemActor();
  let issued = 0;
  let failed = 0;
  for (const enr of due) {
    try {
      const inv = await biller.billRecurringForEnrollment(actor, enr.id);
      if (inv) issued++;
    } catch (err) {
      failed++;
      log('billing-run: enrollment failed', { enrollmentId: enr.id, error: errMsg(err) });
    }
  }
  return { considered: due.length, issued, failed };
}

/**
 * dunning: advance every open, past-due invoice in the CURRENT tenant one step along the ladder.
 * Per-invoice isolation; `advanceDunning` is a no-op outside the retry window, so a re-delivered job
 * cannot double-increment.
 */
export async function runDunningForTenant(
  advancer: DunningAdvancer,
  invoices: DunnableInvoiceSource,
  now: () => Date,
  log: JobLog,
): Promise<DunningRunResult> {
  const nowIso = now().toISOString();
  const dunnable = await invoices.listDunnable(nowIso);
  const actor = systemActor();
  let advanced = 0;
  let failed = 0;
  for (const inv of dunnable) {
    try {
      await advancer.advanceDunning(actor, inv.id);
      advanced++;
    } catch (err) {
      failed++;
      log('dunning: invoice failed', { invoiceId: inv.id, error: errMsg(err) });
    }
  }
  return { considered: dunnable.length, advanced, failed };
}

/**
 * Construct the BillingService + the two repositories the sweeps need, all backed by @obikai/db.
 * Built per job (repositories are stateless and read the active tenant context at query time).
 */
export function makeBillingDeps(now: () => Date = () => new Date()): {
  billing: BillingService;
  enrollments: EnrollmentRepository;
  invoices: InvoiceRepository;
} {
  const enrollments = new EnrollmentRepository();
  const invoices = new InvoiceRepository();
  const billing = new BillingService(
    {
      plans: new PlanRepository(),
      vatRates: new VatRateRepository(),
      enrollments,
      invoices,
      payments: new PaymentAttemptRepository(),
      counters: new InvoiceCounterRepository(),
    },
    now,
  );
  return { billing, enrollments, invoices };
}
