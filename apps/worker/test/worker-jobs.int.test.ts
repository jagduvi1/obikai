import { randomBytes } from 'node:crypto';
import { TenantRegistryRepository, connectMongo, disconnectMongo } from '@obikai/db';
import { type ConnectionOptions, Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type JobDeps, handleJob } from '../src/main.js';
import type { AnyJobData } from '../src/queues.js';

/**
 * I3 — worker / BullMQ integration over a REAL Redis. Drives the actual producer → Redis → Worker →
 * `handleJob` dispatch loop (not the framework-free unit fakes), proving: tenant-scoped jobs run to
 * completion, a not-yet-implemented GDPR job FAILS loudly (audit H2 — never false success), a job
 * missing its `tenantId` is rejected at the worker boundary (ADR-0004), and the platform `billing-tick`
 * fans out per-tenant `billing-run` + `dunning` under `runAsPlatform`.
 *
 * Redis can't run natively on Windows, so the suite SKIPS when no Redis is reachable — but FAILS LOUDLY
 * in CI (where the workflow provides one), so coverage can never silently disappear. Mongo uses an
 * ephemeral in-memory server, as elsewhere.
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function probeRedis(url: string): Promise<boolean> {
  const probe = new Redis(url, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 1500,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const redisUp = await probeRedis(REDIS_URL);
if (!redisUp && process.env.CI) {
  throw new Error(
    `I3 worker integration requires a reachable Redis at ${REDIS_URL} in CI (REDIS_URL).`,
  );
}

// A unique queue per run so a developer's local `jobs` queue is never touched and runs never collide.
const QUEUE = `obikai-i3-${randomBytes(4).toString('hex')}`;

const newConn = (): Redis => new Redis(REDIS_URL, { maxRetriesPerRequest: null });
const asConn = (r: Redis): ConnectionOptions => r as unknown as ConnectionOptions;

describe.skipIf(!redisUp)('worker integration — BullMQ dispatch over real Redis (I3)', () => {
  let mongod: MongoMemoryServer;
  let workerConn: Redis;
  let queueConn: Redis;
  let eventsConn: Redis;
  let worker: Worker;
  let queue: Queue;
  let events: QueueEvents;
  const enqueueSpy = vi.fn(async () => {});

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await connectMongo(mongod.getUri());

    const log = { info: () => {}, error: () => {} };
    const deps: JobDeps = { log, tenancy: 'multi', enqueue: enqueueSpy, notifier: null };

    workerConn = newConn();
    queueConn = newConn();
    eventsConn = newConn();

    // Keep finished jobs so waitUntilFinished can read their state; the queue is obliterated on teardown.
    queue = new Queue(QUEUE, {
      connection: asConn(queueConn),
      defaultJobOptions: { attempts: 1, removeOnComplete: false, removeOnFail: false },
    });
    events = new QueueEvents(QUEUE, { connection: asConn(eventsConn) });
    await events.waitUntilReady();

    worker = new Worker(QUEUE, (job) => handleJob(job, deps), { connection: asConn(workerConn) });
    await worker.waitUntilReady();
  }, 120_000);

  afterAll(async () => {
    await worker?.close();
    await events?.close();
    await queue?.obliterate({ force: true }).catch(() => {});
    await queue?.close();
    workerConn?.disconnect();
    queueConn?.disconnect();
    eventsConn?.disconnect();
    await disconnectMongo();
    await mongod?.stop();
  });

  it('drains a tenant-scoped job and runs it to completion (eligibility-recompute)', async () => {
    const job = await queue.add('eligibility-recompute', { tenantId: 'alpha' });
    await job.waitUntilFinished(events); // rejects if the job failed
    expect(await job.getState()).toBe('completed');
  });

  it('fails loudly on a not-yet-implemented GDPR job (audit H2 — never false success)', async () => {
    const job = await queue.add('gdpr-export', { tenantId: 'alpha' });
    await expect(job.waitUntilFinished(events)).rejects.toThrow(/not implemented/i);
  });

  it('rejects a tenant-scoped job missing its tenantId (ADR-0004 worker-boundary guard)', async () => {
    const job = await queue.add('billing-run', {} as AnyJobData);
    await expect(job.waitUntilFinished(events)).rejects.toThrow(/missing tenantId/i);
  });

  it('fans out a platform billing-tick into per-tenant billing-run + dunning', async () => {
    const registry = new TenantRegistryRepository();
    await registry.ensureRegistered({ slug: 'alpha', name: 'Alpha' });
    enqueueSpy.mockClear();

    const job = await queue.add('billing-tick', {});
    await job.waitUntilFinished(events);

    expect(enqueueSpy).toHaveBeenCalledWith('billing-run', { tenantId: 'alpha' });
    expect(enqueueSpy).toHaveBeenCalledWith('dunning', { tenantId: 'alpha' });
  });
});
