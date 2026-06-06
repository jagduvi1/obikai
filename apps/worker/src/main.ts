/**
 * Obikai background worker entrypoint (ADR-0001).
 *
 * A single BullMQ `Worker` drains the `jobs` queue and dispatches on the job name. The worker is
 * deployed as its own process on the hosted plane; on self-host it can also be started in-process
 * by the api when `config.runWorkerInProcess` is true. Either way this same module is the unit of
 * work, so it MUST be safe to run standalone.
 *
 * Tenancy (ADR-0004): every job payload carries `tenantId`, and each handler does its work inside
 * an explicit `runInTenantContext(tenantId, ...)`. The worker NEVER relies on ambient tenant
 * state and NEVER reads/writes "all tenants" implicitly — that would be a cross-tenant PII vector
 * (ADR-0006 webhook→tenant binding, ADR-0007 erasure-cannot-cross-tenants).
 */
import { type Tenancy, loadConfig } from '@obikai/config';
import { type TenantContext, runInTenantContext } from '@obikai/db';
import { type ConnectionOptions, type Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { type BaseJobData, JOBS_QUEUE, type JobName } from './queues.js';

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

/**
 * Dispatch one job to its handler. Each branch is a documented STUB: it opens tenant context and
 * logs intent. Real billing/dunning/etc. logic lands in later phases behind this seam, so the
 * runtime wiring (queue, context, shutdown) can be verified independently of the domain work.
 */
async function handleJob(job: Job<BaseJobData>, log: Logger, tenancy: Tenancy): Promise<void> {
  const { tenantId } = job.data;
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
    locationScope: 'ALL',
    requestId: job.id ?? `${job.name}:${tenantId}`,
    tenancy,
  };

  const name = job.name as JobName;
  await runInTenantContext(ctx, async () => {
    switch (name) {
      case 'billing-run':
        // Generate due invoices for the tenant's active memberships/subscriptions, then enqueue
        // charges against saved mandates (ADR-0006). STUB.
        log.info('billing-run', { tenantId, jobId: job.id });
        return;
      case 'dunning':
        // Advance overdue invoices through the dunning ladder (reminders, retries, grace, suspend)
        // for the tenant. STUB.
        log.info('dunning', { tenantId, jobId: job.id });
        return;
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

  // BullMQ requires `maxRetriesPerRequest: null` on the shared connection (its blocking commands
  // must not be aborted by ioredis's retry cap).
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

  const worker = new Worker<BaseJobData>(JOBS_QUEUE, (job) => handleJob(job, log, config.tenancy), {
    // The IORedis instance is a valid BullMQ connection at runtime; cast over the dual-ioredis
    // type identity (bullmq bundles its own ioredis types).
    connection: connection as unknown as ConnectionOptions,
  });

  worker.on('failed', (job, err) => {
    log.error('job failed', { jobId: job?.id, name: job?.name, error: err.message });
  });
  worker.on('error', (err) => {
    log.error('worker error', { error: err.message });
  });

  log.info('worker started', { queue: JOBS_QUEUE, deployMode: config.deployMode });

  // Graceful shutdown: stop accepting new jobs, let in-flight jobs finish, close the connection.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal });
    await worker.close();
    await connection.quit();
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
