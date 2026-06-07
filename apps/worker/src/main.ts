/**
 * Obikai background worker entrypoint (ADR-0001).
 *
 * A single BullMQ `Worker` drains the `jobs` queue and dispatches on the job name. The worker is
 * deployed as its own process on the hosted plane; on self-host it can also be started in-process
 * by the api when `config.runWorkerInProcess` is true. Either way this same module is the unit of
 * work, so it MUST be safe to run standalone. It is also a PRODUCER: it registers the recurring
 * `billing-tick` and enqueues that tick's per-tenant fan-out back onto the same queue (ADR-0017).
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
import { type ConnectionOptions, type Job, Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { makeBillingDeps, runBillingForTenant, runDunningForTenant } from './billing-jobs.js';
import {
  type AnyJobData,
  BILLING_TICK,
  type BaseJobData,
  JOBS_QUEUE,
  type JobName,
} from './queues.js';
import { BILLING_TICK_CRON, runBillingTick } from './scheduler.js';

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

/** What each job handler needs from the runtime: a logger, the tenancy axis, and (for the platform
 *  fan-out) the capability to enqueue tenant-scoped follow-up jobs onto the shared queue. */
interface JobDeps {
  readonly log: Logger;
  readonly tenancy: Tenancy;
  readonly enqueue: (name: JobName, data: BaseJobData) => Promise<void>;
}

/**
 * Dispatch one job to its handler. PLATFORM jobs (e.g. `billing-tick`) run FIRST, under the explicit
 * `runAsPlatform(...)` marker, and carry no tenantId — they fan work out per tenant. Everything else
 * is tenant-scoped: it must carry a `tenantId` and runs inside `runInTenantContext`. The tenant
 * branches are documented STUBs where noted; real logic lands behind this seam (ADR-0001/0004).
 */
async function handleJob(job: Job<AnyJobData>, deps: JobDeps): Promise<void> {
  const { log, tenancy, enqueue } = deps;

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
        // the linked enrollment. No-op outside each invoice's retry window (idempotent).
        const { billing, invoices } = makeBillingDeps(now);
        const result = await runDunningForTenant(billing, invoices, now, jobLog);
        log.info('dunning', { tenantId, jobId: job.id, ...result });
        return;
      }
      case 'reminders':
        // Send class/payment/grading reminders via the configured email/sms adapters. STUB.
        log.info('reminders', { tenantId, jobId: job.id });
        return;
      case 'eligibility-recompute':
        // Re-run the pure rank engine to refresh members' "ready/close/not-yet" eligibility after
        // attendance/curriculum changes (ADR-0005). STUB.
        log.info('eligibility-recompute', { tenantId, jobId: job.id });
        return;
      case 'gdpr-export':
        // Assemble the data-subject export driven by the ROPA/retention registry (ADR-0007). STUB.
        log.info('gdpr-export', { tenantId, jobId: job.id });
        return;
      case 'gdpr-erasure':
        // Execute right-to-erasure (pseudonymize-by-reference + per-subject crypto-shred) for the
        // subject; runs in tenant context so it cannot cross tenants (ADR-0007). STUB.
        log.info('gdpr-erasure', { tenantId, jobId: job.id });
        return;
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

  // BullMQ requires `maxRetriesPerRequest: null` on the worker (consumer) connection — its blocking
  // commands must not be aborted by ioredis's retry cap. The producer (Queue) gets its OWN
  // connection: a Worker blocks on its connection, so sharing one with a Queue is discouraged.
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const producerConnection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  // The worker is also a PRODUCER: the platform billing-tick fans out per-tenant jobs back onto this
  // same queue, and we register the recurring tick itself here so the worker is self-contained.
  const queue = new Queue(JOBS_QUEUE, {
    connection: producerConnection as unknown as ConnectionOptions,
  });
  const enqueue = async (name: JobName, data: BaseJobData): Promise<void> => {
    await queue.add(name, data);
  };

  const worker = new Worker<AnyJobData>(
    JOBS_QUEUE,
    (job) => handleJob(job, { log, tenancy: config.tenancy, enqueue }),
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
    { name: BILLING_TICK },
  );

  log.info('worker started', { queue: JOBS_QUEUE, deployMode: config.deployMode });
  log.info('scheduler registered', { job: BILLING_TICK, cron: BILLING_TICK_CRON });

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
