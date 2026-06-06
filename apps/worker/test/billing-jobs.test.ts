import type { AuthzActor } from '@obikai/authz';
import type { Enrollment, Invoice } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  type DueEnrollmentSource,
  type DunnableInvoiceSource,
  type DunningAdvancer,
  type JobLog,
  type RecurringBiller,
  runBillingForTenant,
  runDunningForTenant,
} from '../src/billing-jobs.js';

const NOW = (): Date => new Date('2026-06-06T00:00:00.000Z');
const enr = (id: string): Enrollment => ({ id }) as Enrollment;
const inv = (id: string): Invoice => ({ id }) as Invoice;

/** Collects log lines so we can assert isolated failures were reported. */
function makeLog(): { log: JobLog; lines: { msg: string; meta?: Record<string, unknown> }[] } {
  const lines: { msg: string; meta?: Record<string, unknown> }[] = [];
  return { log: (msg, meta) => lines.push({ msg, meta }), lines };
}

describe('runBillingForTenant', () => {
  it('bills every due enrollment and counts the issued invoices', async () => {
    const seen: string[] = [];
    const biller: RecurringBiller = {
      async billRecurringForEnrollment(_actor: AuthzActor, id: string) {
        seen.push(id);
        return inv(`i-${id}`); // each produces an invoice
      },
    };
    const enrollments: DueEnrollmentSource = {
      async listDueForBilling() {
        return [enr('a'), enr('b'), enr('c')];
      },
    };
    const { log } = makeLog();
    const r = await runBillingForTenant(biller, enrollments, NOW, log);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(r).toEqual({ considered: 3, issued: 3, failed: 0 });
  });

  it('counts a null return (nothing due) as considered-but-not-issued', async () => {
    const biller: RecurringBiller = {
      async billRecurringForEnrollment(_a, id) {
        return id === 'b' ? null : inv(`i-${id}`);
      },
    };
    const enrollments: DueEnrollmentSource = {
      async listDueForBilling() {
        return [enr('a'), enr('b')];
      },
    };
    const { log } = makeLog();
    const r = await runBillingForTenant(biller, enrollments, NOW, log);
    expect(r).toEqual({ considered: 2, issued: 1, failed: 0 });
  });

  it('isolates a failing enrollment: logs it and keeps going', async () => {
    const biller: RecurringBiller = {
      async billRecurringForEnrollment(_a, id) {
        if (id === 'b') throw new Error('boom');
        return inv(`i-${id}`);
      },
    };
    const enrollments: DueEnrollmentSource = {
      async listDueForBilling() {
        return [enr('a'), enr('b'), enr('c')];
      },
    };
    const { log, lines } = makeLog();
    const r = await runBillingForTenant(biller, enrollments, NOW, log);
    expect(r).toEqual({ considered: 3, issued: 2, failed: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.meta?.enrollmentId).toBe('b');
  });

  it('passes asOf as a YYYY-MM-DD date derived from the clock', async () => {
    let receivedAsOf = '';
    const enrollments: DueEnrollmentSource = {
      async listDueForBilling(asOf) {
        receivedAsOf = asOf;
        return [];
      },
    };
    const biller: RecurringBiller = {
      async billRecurringForEnrollment() {
        return null;
      },
    };
    const { log } = makeLog();
    await runBillingForTenant(biller, enrollments, NOW, log);
    expect(receivedAsOf).toBe('2026-06-06');
  });
});

describe('runDunningForTenant', () => {
  it('advances every dunnable invoice', async () => {
    const seen: string[] = [];
    const advancer: DunningAdvancer = {
      async advanceDunning(_a: AuthzActor, id: string) {
        seen.push(id);
        return inv(id);
      },
    };
    const invoices: DunnableInvoiceSource = {
      async listDunnable() {
        return [inv('x'), inv('y')];
      },
    };
    const { log } = makeLog();
    const r = await runDunningForTenant(advancer, invoices, NOW, log);
    expect(seen).toEqual(['x', 'y']);
    expect(r).toEqual({ considered: 2, advanced: 2, failed: 0 });
  });

  it('isolates a failing invoice', async () => {
    const advancer: DunningAdvancer = {
      async advanceDunning(_a, id) {
        if (id === 'y') throw new Error('nope');
        return inv(id);
      },
    };
    const invoices: DunnableInvoiceSource = {
      async listDunnable() {
        return [inv('x'), inv('y'), inv('z')];
      },
    };
    const { log, lines } = makeLog();
    const r = await runDunningForTenant(advancer, invoices, NOW, log);
    expect(r).toEqual({ considered: 3, advanced: 2, failed: 1 });
    expect(lines[0]?.meta?.invoiceId).toBe('y');
  });

  it('passes a full ISO timestamp to listDunnable', async () => {
    let receivedNow = '';
    const invoices: DunnableInvoiceSource = {
      async listDunnable(nowIso) {
        receivedNow = nowIso;
        return [];
      },
    };
    const advancer: DunningAdvancer = {
      async advanceDunning() {
        return inv('x');
      },
    };
    const { log } = makeLog();
    await runDunningForTenant(advancer, invoices, NOW, log);
    expect(receivedNow).toBe('2026-06-06T00:00:00.000Z');
  });
});
