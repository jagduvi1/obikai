import type { AuthzActor } from '@obikai/authz';
import type {
  CurrencyTotal,
  EnrollmentPlanRef,
  MonthCount,
  PlanPricing,
  StatusCount,
} from '@obikai/db';
import { describe, expect, it } from 'vitest';
import { ForbiddenError, ReportingService, type ReportingSource } from './reporting.service.js';

const NOW = new Date('2026-06-15T12:00:00.000Z');

const staff: AuthzActor = { userId: 'u1', roles: [{ role: 'staff', locationScope: 'ALL' }] };
const bareMember: AuthzActor = {
  userId: 'u9',
  memberId: 'm9',
  roles: [{ role: 'member', locationScope: 'ALL' }],
};

/** A fake source with sensible defaults; tests override the slices they care about. */
function source(over: Partial<ReportingSource> = {}): ReportingSource {
  return {
    async membersByStatus(): Promise<StatusCount[]> {
      return [
        { status: 'active', count: 3 },
        { status: 'trial', count: 2 },
      ];
    },
    async newMembersSince(): Promise<number> {
      return 4;
    },
    async outstanding(): Promise<{ byCurrency: CurrencyTotal[]; toRecover: number }> {
      return { byCurrency: [{ currency: 'SEK', count: 5, totalMinor: 250_000 }], toRecover: 2 };
    },
    async attendanceByMonth(): Promise<MonthCount[]> {
      return [{ month: '2026-06', count: 40 }];
    },
    async activeEnrollmentPlanRefs(): Promise<EnrollmentPlanRef[]> {
      // two monthly, one yearly, one one-off.
      return [
        { planId: 'mo' },
        { planId: 'mo' },
        { planId: 'yr' },
        { planId: 'once' },
        { planId: 'gone' }, // plan deleted → skipped
      ];
    },
    async planPricing(): Promise<PlanPricing[]> {
      return [
        { id: 'mo', amountMinor: 50_000, currency: 'SEK', interval: 'monthly' },
        { id: 'yr', amountMinor: 1_200_000, currency: 'SEK', interval: 'yearly' },
        { id: 'once', amountMinor: 30_000, currency: 'SEK', interval: 'none' },
      ];
    },
    async activeMemberIds(): Promise<string[]> {
      return ['m1', 'm2', 'm3'];
    },
    async attendeeIdsSince(): Promise<string[]> {
      return ['m1']; // only m1 trained recently → m2, m3 at risk
    },
    ...over,
  };
}

describe('ReportingService.ownerDashboard', () => {
  it('forbids a non-staff actor', async () => {
    const svc = new ReportingService(source());
    await expect(svc.ownerDashboard(bareMember, NOW)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('composes members, MRR (interval-normalized), outstanding, at-risk, and trend', async () => {
    const svc = new ReportingService(source());
    const d = await svc.ownerDashboard(staff, NOW);

    expect(d.members).toMatchObject({ active: 3, newThisMonth: 4 });
    // MRR: 2× 50000/mo + 1× 1200000/12 (=100000/mo) + one-off skipped = 200000 SEK.
    expect(d.revenue.mrr).toEqual([{ currency: 'SEK', amountMinor: 200_000 }]);
    expect(d.revenue.outstanding).toEqual([{ currency: 'SEK', amountMinor: 250_000 }]);
    expect(d.revenue.outstandingCount).toBe(5);
    expect(d.revenue.toRecover).toBe(2);
    // At-risk: active m1/m2/m3 minus attendee m1 = 2.
    expect(d.atRisk).toBe(2);
    expect(d.attendanceTrend).toEqual([{ month: '2026-06', count: 40 }]);
    expect(d.generatedAt).toBe('2026-06-15T12:00:00.000Z');
  });

  it('reports zero MRR/at-risk gracefully when there is no data', async () => {
    const svc = new ReportingService(
      source({
        async activeEnrollmentPlanRefs() {
          return [];
        },
        async activeMemberIds() {
          return [];
        },
        async attendeeIdsSince() {
          return [];
        },
      }),
    );
    const d = await svc.ownerDashboard(staff, NOW);
    expect(d.revenue.mrr).toEqual([]);
    expect(d.atRisk).toBe(0);
  });
});
