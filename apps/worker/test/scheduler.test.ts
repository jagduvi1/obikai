import { describe, expect, it } from 'vitest';
import type { BaseJobData, JobName } from '../src/queues.js';
import {
  type JobEnqueuer,
  type JobLog,
  type TenantSource,
  runBillingTick,
} from '../src/scheduler.js';

/** Records every enqueue so we can assert the fan-out shape (N tenants → 2N tenant-scoped jobs). */
function makeEnqueuer(failFor?: string): {
  enqueuer: JobEnqueuer;
  calls: { name: JobName; tenantId: string }[];
} {
  const calls: { name: JobName; tenantId: string }[] = [];
  return {
    enqueuer: {
      async enqueue(name: JobName, data: BaseJobData) {
        if (data.tenantId === failFor) throw new Error('redis down');
        calls.push({ name, tenantId: data.tenantId });
      },
    },
    calls,
  };
}

function makeLog(): { log: JobLog; lines: { msg: string; meta?: Record<string, unknown> }[] } {
  const lines: { msg: string; meta?: Record<string, unknown> }[] = [];
  return { log: (msg, meta) => lines.push({ msg, meta }), lines };
}

const source = (slugs: string[]): TenantSource => ({
  async listActiveSlugs() {
    return slugs;
  },
});

describe('runBillingTick', () => {
  it('fans out billing-run + dunning per active tenant', async () => {
    const { enqueuer, calls } = makeEnqueuer();
    const { log } = makeLog();
    const r = await runBillingTick(source(['t1', 't2', 't3']), enqueuer, log);

    expect(r).toEqual({ tenants: 3, enqueued: 6, failed: 0 });
    expect(calls).toEqual([
      { name: 'billing-run', tenantId: 't1' },
      { name: 'dunning', tenantId: 't1' },
      { name: 'billing-run', tenantId: 't2' },
      { name: 'dunning', tenantId: 't2' },
      { name: 'billing-run', tenantId: 't3' },
      { name: 'dunning', tenantId: 't3' },
    ]);
  });

  it('does nothing when there are no active tenants', async () => {
    const { enqueuer, calls } = makeEnqueuer();
    const { log } = makeLog();
    const r = await runBillingTick(source([]), enqueuer, log);
    expect(r).toEqual({ tenants: 0, enqueued: 0, failed: 0 });
    expect(calls).toHaveLength(0);
  });

  it('isolates a failing tenant: logs it and keeps fanning out the rest', async () => {
    const { enqueuer, calls } = makeEnqueuer('t2');
    const { log, lines } = makeLog();
    const r = await runBillingTick(source(['t1', 't2', 't3']), enqueuer, log);

    // t2 fails on its first enqueue (billing-run); t1 and t3 each produce their 2 jobs.
    expect(r).toEqual({ tenants: 3, enqueued: 4, failed: 1 });
    expect(calls.map((c) => c.tenantId)).toEqual(['t1', 't1', 't3', 't3']);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.meta?.tenantId).toBe('t2');
  });
});
