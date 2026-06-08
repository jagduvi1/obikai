import { type AuthzActor, can } from '@obikai/authz';
import type {
  CurrencyTotal,
  EnrollmentPlanRef,
  MonthCount,
  PlanPricing,
  StatusCount,
} from '@obikai/db';
import { type BillingInterval, type OwnerDashboard, intervalMonths } from '@obikai/domain';

/**
 * ReportingService — composes the tenant-guarded aggregates into the action-oriented owner dashboard
 * (scope §4.9). Framework-free; RBAC via `can()` (reuses `member:list` — anyone who may see the member
 * roster may see its aggregate stats). Money is kept per-currency and never mixed.
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

/** A member with no attendance in this many days counts as "at risk" (churn early-warning). */
const AT_RISK_DAYS = 21;
/** Months of attendance trend to surface. */
const TREND_MONTHS = 6;

export interface ReportingSource {
  membersByStatus(): Promise<StatusCount[]>;
  newMembersSince(since: Date): Promise<number>;
  outstanding(): Promise<{ byCurrency: CurrencyTotal[]; toRecover: number }>;
  attendanceByMonth(since: Date): Promise<MonthCount[]>;
  activeEnrollmentPlanRefs(): Promise<EnrollmentPlanRef[]>;
  planPricing(): Promise<PlanPricing[]>;
  activeMemberIds(): Promise<string[]>;
  attendeeIdsSince(since: Date): Promise<string[]>;
}

function startOfMonthUTC(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function daysAgoUTC(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
function monthsAgoUTC(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
}

export class ReportingService {
  constructor(private readonly repo: ReportingSource) {}

  async ownerDashboard(actor: AuthzActor, now: Date): Promise<OwnerDashboard> {
    if (!can(actor, { resource: 'member', action: 'list' }))
      throw new ForbiddenError('list', 'member');

    const [byStatus, newThisMonth, outstanding, trend, enrollRefs, plans, activeIds, attendees] =
      await Promise.all([
        this.repo.membersByStatus(),
        this.repo.newMembersSince(startOfMonthUTC(now)),
        this.repo.outstanding(),
        this.repo.attendanceByMonth(monthsAgoUTC(now, TREND_MONTHS)),
        this.repo.activeEnrollmentPlanRefs(),
        this.repo.planPricing(),
        this.repo.activeMemberIds(),
        this.repo.attendeeIdsSince(daysAgoUTC(now, AT_RISK_DAYS)),
      ]);

    const active = byStatus.find((s) => s.status === 'active')?.count ?? 0;

    // MRR: normalize each active enrollment's plan price to a monthly amount (skip one-off plans),
    // summed per currency (never mixing currencies).
    const planById = new Map(plans.map((p) => [p.id, p]));
    const mrrByCurrency = new Map<string, number>();
    for (const ref of enrollRefs) {
      const plan = planById.get(ref.planId);
      if (!plan) continue;
      const months = intervalMonths(plan.interval as BillingInterval);
      if (months <= 0) continue; // non-recurring → no MRR contribution
      const monthly = Math.round(plan.amountMinor / months);
      mrrByCurrency.set(plan.currency, (mrrByCurrency.get(plan.currency) ?? 0) + monthly);
    }

    // At-risk: active members with no attendance in the window.
    const attended = new Set(attendees);
    const atRisk = activeIds.filter((id) => !attended.has(id)).length;

    return {
      members: { active, newThisMonth, byStatus },
      revenue: {
        mrr: [...mrrByCurrency].map(([currency, amountMinor]) => ({ currency, amountMinor })),
        outstanding: outstanding.byCurrency.map((c) => ({
          currency: c.currency,
          amountMinor: c.totalMinor,
        })),
        outstandingCount: outstanding.byCurrency.reduce((n, c) => n + c.count, 0),
        toRecover: outstanding.toRecover,
      },
      atRisk,
      attendanceTrend: trend,
      generatedAt: now.toISOString(),
    };
  }
}
