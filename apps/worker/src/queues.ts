/**
 * Queue + job-name vocabulary for the Obikai background worker (ADR-0001 dedicated worker — runs as
 * its own process/container; an in-process self-host mode is reserved but not yet implemented).
 * Declared ONCE here and imported by both the producer (api) and the consumer (worker) so a typo in
 * a job name is a compile error rather than a silently dropped job.
 *
 * Every job MUST carry `tenantId` in its payload — the processor opens an explicit tenant
 * context via `runInTenantContext` (ADR-0004/0006/0007); ambient/"all tenants" access is never
 * assumed in a job.
 */

/** The single BullMQ queue all background work flows through. */
export const JOBS_QUEUE = 'jobs' as const;
export type JobsQueueName = typeof JOBS_QUEUE;

/**
 * The exhaustive set of TENANT-SCOPED job names the worker handles. Each runs inside
 * `runInTenantContext` and so must carry a `tenantId`. Adding a name here forces the `switch` in
 * `main.ts` to handle it (the switch is `noFallthroughCasesInSwitch` + exhaustive).
 */
export const JOB_NAMES = [
  'billing-run',
  'dunning',
  'reminders',
  'eligibility-recompute',
  'gdpr-export',
  'gdpr-erasure',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/**
 * PLATFORM (cross-tenant) job names. These run under the explicit `runAsPlatform(...)` marker
 * (ADR-0004/0017), carry NO `tenantId`, and fan work out into per-tenant tenant-scoped jobs. They
 * are deliberately a separate vocabulary so a platform job can never be mistaken for, or routed
 * through, the tenant-scoped path that demands a `tenantId`.
 */
export const PLATFORM_JOB_NAMES = ['billing-tick'] as const;
export type PlatformJobName = (typeof PLATFORM_JOB_NAMES)[number];

/** The daily recurring fan-out that enqueues per-tenant billing-run + dunning (ADR-0017). */
export const BILLING_TICK: PlatformJobName = 'billing-tick';

/** Every job name the worker may receive (tenant-scoped + platform). */
export type AnyJobName = JobName | PlatformJobName;

/**
 * Shape every TENANT-SCOPED job payload shares: the tenant the work runs against. Concrete jobs
 * extend this with their own fields; the worker only relies on `tenantId` being present to open
 * context.
 */
export interface BaseJobData {
  readonly tenantId: string;
}

/** Platform jobs are deliberately tenant-less — the handler fans out per tenant. */
export type PlatformJobData = Record<string, never>;

/** A job is either tenant-scoped or platform; the worker discriminates on `job.name`. */
export type AnyJobData = BaseJobData | PlatformJobData;
