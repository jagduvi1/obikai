/**
 * Queue + job-name vocabulary for the Obikai background worker (ADR-0001 dedicated worker;
 * runs in-process in self-host when `runWorkerInProcess` is set). Declared ONCE here and
 * imported by both the producer (api) and the consumer (worker) so a typo in a job name is a
 * compile error rather than a silently dropped job.
 *
 * Every job MUST carry `tenantId` in its payload — the processor opens an explicit tenant
 * context via `runInTenantContext` (ADR-0004/0006/0007); ambient/"all tenants" access is never
 * assumed in a job.
 */

/** The single BullMQ queue all background work flows through. */
export const JOBS_QUEUE = 'jobs' as const;
export type JobsQueueName = typeof JOBS_QUEUE;

/**
 * The exhaustive set of job names the worker handles. Adding a name here forces the `switch` in
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
 * Shape every job payload shares: the tenant the work runs against. Concrete jobs extend this
 * with their own fields; the worker only relies on `tenantId` being present to open context.
 */
export interface BaseJobData {
  readonly tenantId: string;
}
