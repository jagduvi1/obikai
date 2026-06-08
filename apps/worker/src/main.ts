/**
 * Obikai background worker entrypoint (ADR-0001).
 *
 * A single BullMQ `Worker` drains the `jobs` queue and dispatches on the job name. The worker runs as
 * its OWN process/container in every deploy mode (`docker compose up` starts it); hosting it inside
 * the api process (`runWorkerInProcess`) is reserved for a future self-host mode but not yet wired,
 * so this module is the sole place jobs are processed. It is also a PRODUCER: it registers the
 * recurring `billing-tick` and enqueues that tick's per-tenant fan-out back onto the same queue (ADR-0017).
 *
 * Tenancy (ADR-0004): every TENANT-SCOPED job carries `tenantId` and does its work inside an explicit
 * `runInTenantContext(tenantId, ...)`. The worker NEVER relies on ambient tenant state and NEVER
 * reads/writes "all tenants" implicitly — that would be a cross-tenant PII vector (ADR-0006
 * webhook→tenant binding, ADR-0007 erasure-cannot-cross-tenants). The lone exception is the explicit
 * PLATFORM job (`billing-tick`): it carries no tenantId and runs under the audited `runAsPlatform`
 * marker purely to enumerate active tenants and fan out scoped jobs — never to touch tenant data.
 */
import { type Tenancy, loadConfig } from '@obikai/config';
import {
  type TenantContext,
  TenantRegistryRepository,
  connectMongo,
  disconnectMongo,
  runAsPlatform,
  runInTenantContext,
} from '@obikai/db';
import type { Booking, ClassOccurrence, Invoice } from '@obikai/domain';
import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { makeBillingDeps, runBillingForTenant, runDunningForTenant } from './billing-jobs.js';
import { type WorkerNotifier, buildWorkerNotifier } from './notifications-jobs.js';
import {
  type AnyJobData,
  BILLING_TICK,
  type BaseJobData,
  JOBS_QUEUE,
  type JobName,
  REMINDERS_TICK,
} from './queues.js';
import { makeReminderDeps, runRemindersForTenant } from './reminders-jobs.js';
import {
  BILLING_TICK_CRON,
  REMINDERS_TICK_CRON,
  runBillingTick,
  runRemindersTick,
} from './scheduler.js';

/** How far ahead a class reminder reaches: members booked into a class starting within this window
 *  get reminded (once). 24h is the default lead; the hourly tick catches short-notice bookings. */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1_000;

/**
 * Minimal structured logger. We avoid `console.log` (lint-forbidden) and depend on no logging
 * library here; the api wires a richer logger when it hosts the worker in-process. Lines are
 * single-line JSON so they aggregate cleanly in any log shipper.
 */
interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

function makeLogger(): Logger {
  const write = (
    stream: NodeJS.WriteStream,
    level: string,
    msg: string,
    meta?: Record<string, unknown>,
  ): void => {
    const line = JSON.stringify({ level, msg, ...(meta ?? {}) });
    stream.write(`${line}\n`);
  };
  return {
    info: (msg, meta) => write(process.stdout, 'info', msg, meta),
    error: (msg, meta) => write(process.stderr, 'error', msg, meta),
  };
}

/** What each job handler needs from the runtime: a logger, the tenancy axis, the capability to
 *  enqueue tenant-scoped follow-up jobs (platform fan-out), and the optional notifier for the jobs
 *  that send mail (null when email is not configured). */
interface JobDeps {
  readonly log: Logger;
  readonly tenancy: Tenancy;
  readonly enqueue: (name: JobName, data: BaseJobData) => Promise<void>;
  readonly notifier: WorkerNotifier | null;
}

/**
 * Dispatch one job to its handler. PLATFORM jobs (e.g. `billing-tick`) run FIRST, under the explicit
 * `runAsPlatform(...)` marker, and carry no tenantId — they fan work out per tenant. Everything else
 * is tenant-scoped: it must carry a `tenantId` and runs inside `runInTenantContext`. The tenant
 * branches are documented STUBs where noted; real logic lands behind this seam (ADR-0001/0004).
 */
async function handleJob(job: Job<AnyJobData>, deps: JobDeps): Promise<void> {
  const { log, tenancy, enqueue, notifier } = deps;

  // ── Platform (cross-tenant) jobs — explicit marker, no tenantId (ADR-0004/0017) ──────────────
  if (job.name === BILLING_TICK) {
    await runAsPlatform(async () => {
      const registry = new TenantRegistryRepository();
      const tickLog = (msg: string, meta?: Record<string, unknown>): void =>
        log.error(msg, { ...meta, jobId: job.id });
      const result = await runBillingTick(
        { listActiveSlugs: async () => (await registry.listActive()).map((tenant) => tenant.slug) },
        { enqueue },
        tickLog,
      );
      log.info('billing-tick', { jobId: job.id, ...result });
    });
    return;
  }

  if (job.name === REMINDERS_TICK) {
    await runAsPlatform(async () => {
      const registry = new TenantRegistryRepository();
      const tickLog = (msg: string, meta?: Record<string, unknown>): void =>
        log.error(msg, { ...meta, jobId: job.id });
      const result = await runRemindersTick(
        { listActiveSlugs: async () => (await registry.listActive()).map((tenant) => tenant.slug) },
        { enqueue },
        tickLog,
      );
      log.info('reminders-tick', { jobId: job.id, ...result });
    });
    return;
  }

  // ── Tenant-scoped jobs — require a tenantId, run in tenant context ────────────────────────────
  const { tenantId } = job.data as BaseJobData;
  if (!tenantId) {
    // A job without a tenant cannot be scoped safely — fail loudly rather than guess (ADR-0004).
    throw new Error(`job ${job.id ?? '?'} (${job.name}) is missing tenantId`);
  }

  // Build an EXPLICIT system context for the job — never ambient (ADR-0004). System actor: no
  // user/session, tenant-wide location scope; the job id is the correlation id.
  const ctx: TenantContext = {
    tenantId,
    userId: null,
    sessionId: null,
    roles: [],
    memberId: null,
    requestId: job.id ?? `${job.name}:${tenantId}`,
    tenancy,
  };

  const name = job.name as JobName;
  await runInTenantContext(ctx, async () => {
    // Per-item failures inside a sweep are logged via this and never abort the whole job.
    const jobLog = (msg: string, meta?: Record<string, unknown>): void =>
      log.error(msg, { ...meta, jobId: job.id });
    const now = (): Date => new Date();
    switch (name) {
      case 'billing-run': {
        // Issue the next due recurring invoice for every active enrollment in this tenant. The
        // BillingService is idempotent (one invoice per enrollment-period), so re-delivery is safe.
        const { billing, enrollments } = makeBillingDeps(now);
        const result = await runBillingForTenant(billing, enrollments, now, jobLog);
        log.info('billing-run', { tenantId, jobId: job.id, ...result });
        return;
      }
      case 'dunning': {
        // Advance overdue OPEN invoices one step along the dunning ladder; the final rung freezes
        // the linked enrollment. No-op outside each invoice's retry window (idempotent). When mail is
        // configured, email the member each notice — best-effort, never aborting the advance.
        const { billing, invoices } = makeBillingDeps(now);
        const onAdvanced = notifier
          ? (inv: Invoice): Promise<void> => notifier.dunningNotice(tenantId, inv)
          : undefined;
        const result = await runDunningForTenant(billing, invoices, now, jobLog, onAdvanced);
        log.info('dunning', { tenantId, jobId: job.id, ...result });
        return;
      }
      case 'reminders': {
        // Email each booked member of every class starting within the lead window, once (the booking
        // is claimed before its reminder is sent — at-most-once). No-op when mail isn't configured.
        if (!notifier) {
          log.info('reminders skipped: no notifier', { tenantId, jobId: job.id });
          return;
        }
        const { occurrences, roster } = makeReminderDeps();
        const sender = {
          classReminder: (occ: ClassOccurrence, bk: Booking): Promise<boolean> =>
            notifier.classReminder(tenantId, occ, bk),
        };
        const result = await runRemindersForTenant(
          occurrences,
          roster,
          sender,
          now,
          REMINDER_LEAD_MS,
          jobLog,
        );
        log.info('reminders', { tenantId, jobId: job.id, ...result });
        return;
      }
      case 'eligibility-recompute':
        // Re-run the pure rank engine to refresh members' "ready/close/not-yet" eligibility after
        // attendance/curriculum changes (ADR-0005). STUB.
        log.info('eligibility-recompute', { tenantId, jobId: job.id });
        return;
      case 'gdpr-export':
      case 'gdpr-erasure':
        // NOT YET IMPLEMENTED (ADR-0007; tracked in docs/gdpr-audit-2026-06.md H4/H7). These jobs are
        // registered but their handlers are not built. We THROW rather than log-and-return so an
        // enqueued data-subject request FAILS LOUDLY instead of reporting false success (audit H2) —
        // a "completed" export/erasure that did nothing is worse than an error. Real implementations
        // (ExportService / ErasureService driven by the ROPA registry) replace this in G5/G6.
        throw new Error(
          `${name} is not implemented yet (tenant ${tenantId}, job ${job.id ?? '?'})`,
        );
      default: {
        // Exhaustiveness guard: a new JobName without a case here is a compile error.
        const unhandled: never = name;
        throw new Error(`unhandled job name: ${String(unhandled)}`);
      }
    }
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = makeLogger();

  // Billing/dunning/GDPR jobs use the tenant-scoped @obikai/db repositories, which need a live
  // mongoose connection — connect BEFORE the worker starts draining jobs, or the first DB-backed job
  // would fail with no connection. (The api connects in its own bootstrap.)
  await connectMongo(config.mongoUri);
  log.info('connected to MongoDB');

  // Build the transactional-email notifier once (opens the SMTP transport). Null when email is not
  // configured (non-smtp provider) — the jobs then run without sending notices (ADR-0003).
  const notifier = await buildWorkerNotifier(config, (msg, meta) => log.info(msg, meta));
  if (notifier) log.info('notifier ready', { provider: config.email.provider });

  // BullMQ requires `maxRetriesPerRequest: null` on the worker (consumer) connection — its blocking
  // commands must not be aborted by ioredis's retry cap. The producer (Queue) gets its OWN
  // connection: a Worker blocks on its connection, so sharing one with a Queue is discouraged.
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const producerConnection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  // The worker is also a PRODUCER: the platform billing-tick fans out per-tenant jobs back onto this
  // same queue, and we register the recurring tick itself here so the worker is self-contained.
  // Durability defaults for EVERY enqueued job: retry transient Mongo/Redis blips with exponential
  // backoff (a single failure must not permanently drop a tenant's billing/dunning run), and bound
  // Redis memory by reaping old completed/failed jobs (else they accumulate unbounded on the small
  // self-host footprint). Handlers stay idempotent (per-(enrollment,period) dedupe), so retries are safe.
  const queue = new Queue(JOBS_QUEUE, {
    connection: producerConnection as unknown as ConnectionOptions,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 3_600, count: 1_000 },
      removeOnFail: { age: 14 * 24 * 3_600 },
    },
  });
  const enqueue = async (name: JobName, data: BaseJobData): Promise<void> => {
    await queue.add(name, data);
  };

  const worker = new Worker<AnyJobData>(
    JOBS_QUEUE,
    (job) => handleJob(job, { log, tenancy: config.tenancy, enqueue, notifier }),
    {
      // The IORedis instance is a valid BullMQ connection at runtime; cast over the dual-ioredis
      // type identity (bullmq bundles its own ioredis types).
      connection: connection as unknown as ConnectionOptions,
    },
  );

  worker.on('failed', (job, err) => {
    log.error('job failed', { jobId: job?.id, name: job?.name, error: err.message });
  });
  worker.on('error', (err) => {
    log.error('worker error', { error: err.message });
  });

  // Register the daily recurring billing-tick (ADR-0017). `upsertJobScheduler` is idempotent — on
  // every restart it updates the existing schedule rather than stacking duplicates.
  await queue.upsertJobScheduler(
    BILLING_TICK,
    { pattern: BILLING_TICK_CRON },
    // The tick only fans out; if a run fails the next cron fires anyway, so keep retries low and reap
    // its history so the repeatable job doesn't pile up.
    {
      name: BILLING_TICK,
      opts: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3_600, count: 100 },
        removeOnFail: { age: 14 * 24 * 3_600 },
      },
    },
  );

  // Register the hourly reminders-tick ONLY when mail is configured — without a notifier the per-tenant
  // sweeps would fan out hourly only to no-op, needless Redis churn on a no-email self-host (ADR-0017).
  if (notifier) {
    await queue.upsertJobScheduler(
      REMINDERS_TICK,
      { pattern: REMINDERS_TICK_CRON },
      {
        name: REMINDERS_TICK,
        opts: {
          attempts: 2,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 24 * 3_600, count: 100 },
          removeOnFail: { age: 14 * 24 * 3_600 },
        },
      },
    );
  }

  log.info('worker started', { queue: JOBS_QUEUE, deployMode: config.deployMode });
  log.info('scheduler registered', { job: BILLING_TICK, cron: BILLING_TICK_CRON });
  if (notifier) {
    log.info('scheduler registered', { job: REMINDERS_TICK, cron: REMINDERS_TICK_CRON });
  }

  // Graceful shutdown: stop accepting new jobs, let in-flight jobs finish, close the connections.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    await worker.close();
    await queue.close();
    await connection.quit();
    await producerConnection.quit();
    if (notifier) await notifier.dispose();
    await disconnectMongo();
    log.info('shutdown complete');
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

void main();
