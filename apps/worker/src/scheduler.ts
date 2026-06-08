import type { BaseJobData, JobName } from './queues.js';

/**
 * The billing-tick fan-out (ADR-0017). A single daily PLATFORM job enumerates the active tenants and
 * enqueues a per-tenant `billing-run` + `dunning` for each. It runs under the explicit
 * `runAsPlatform(...)` marker (the only sanctioned cross-tenant read, ADR-0004); the jobs it emits
 * are tenant-scoped (each carries a `tenantId`) and the worker processes them in `runInTenantContext`
 * exactly as if a human or the api had enqueued them.
 *
 * The logic here is pure and framework-free: it takes a tenant source + an enqueue capability so it
 * unit-tests against light fakes, with no Redis/BullMQ in the loop. main.ts wires the real
 * TenantRegistryRepository (under runAsPlatform) and a BullMQ-backed enqueuer.
 */

/** Default cron for the daily billing fan-out: 02:00 every day (server-local to the worker's TZ). */
export const BILLING_TICK_CRON = '0 2 * * *';

/** Default cron for the reminders fan-out: top of every hour. Frequent enough that a class booked at
 *  short notice still falls inside the next sweep's lead window; the per-booking claim keeps it
 *  at-most-once regardless of how often the tick runs. */
export const REMINDERS_TICK_CRON = '0 * * * *';

/** Source of the active tenants to fan out to (backed by TenantRegistryRepository.listActive). */
export interface TenantSource {
  listActiveSlugs(): Promise<string[]>;
}

/** Capability to enqueue a tenant-scoped job onto the shared queue (backed by a BullMQ Queue). */
export interface JobEnqueuer {
  enqueue(name: JobName, data: BaseJobData): Promise<void>;
}

export type JobLog = (msg: string, meta?: Record<string, unknown>) => void;

export interface BillingTickResult {
  tenants: number;
  enqueued: number;
  failed: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fan out the daily recurring billing work: for every active tenant, enqueue a `billing-run` and a
 * `dunning` job scoped to that tenant. Per-tenant isolation — a failed enqueue for one tenant is
 * logged and skipped, never aborting the whole sweep. Both downstream jobs are idempotent at the
 * service layer, so a re-delivered tick never double-bills.
 */
export async function runBillingTick(
  tenants: TenantSource,
  enqueuer: JobEnqueuer,
  log: JobLog,
): Promise<BillingTickResult> {
  const slugs = await tenants.listActiveSlugs();
  let enqueued = 0;
  let failed = 0;
  for (const slug of slugs) {
    try {
      await enqueuer.enqueue('billing-run', { tenantId: slug });
      await enqueuer.enqueue('dunning', { tenantId: slug });
      enqueued += 2;
    } catch (err) {
      failed++;
      log('billing-tick: tenant fan-out failed', { tenantId: slug, error: errMsg(err) });
    }
  }
  return { tenants: slugs.length, enqueued, failed };
}

export interface RemindersTickResult {
  tenants: number;
  enqueued: number;
  failed: number;
}

/**
 * Fan out the hourly class-reminder work: for every active tenant, enqueue one tenant-scoped
 * `reminders` sweep. Per-tenant isolation — a failed enqueue for one tenant is logged and skipped,
 * never aborting the whole fan-out. The sweep is idempotent (each booking is claimed before its
 * reminder is sent), so a re-delivered tick never double-reminds.
 */
export async function runRemindersTick(
  tenants: TenantSource,
  enqueuer: JobEnqueuer,
  log: JobLog,
): Promise<RemindersTickResult> {
  const slugs = await tenants.listActiveSlugs();
  let enqueued = 0;
  let failed = 0;
  for (const slug of slugs) {
    try {
      await enqueuer.enqueue('reminders', { tenantId: slug });
      enqueued += 1;
    } catch (err) {
      failed++;
      log('reminders-tick: tenant fan-out failed', { tenantId: slug, error: errMsg(err) });
    }
  }
  return { tenants: slugs.length, enqueued, failed };
}
