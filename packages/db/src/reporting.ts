import { AttendanceModel } from './attendance.js';
import { EnrollmentModel, InvoiceModel, PlanModel } from './billing.js';
import { MemberModel } from './member.js';

/**
 * ReportingRepository — read-only aggregates for the owner dashboard (scope §4.9). Every query runs
 * through a tenant-guarded model, so the `tenantGuard` plugin scopes finds/counts AND aggregation
 * pipelines (it unshifts a tenant `$match` and bans `$out`/`$merge`) — a tenant's report can never
 * touch another tenant's data (ADR-0004). Composition of cross-collection numbers (MRR, at-risk) is
 * done in the app layer; this layer returns the indexed primitives.
 */
export interface StatusCount {
  status: string;
  count: number;
}
export interface CurrencyTotal {
  currency: string;
  count: number;
  totalMinor: number;
}
export interface MonthCount {
  month: string;
  count: number;
}
export interface EnrollmentPlanRef {
  planId: string;
}
export interface PlanPricing {
  id: string;
  amountMinor: number;
  currency: string;
  interval: string;
}

export class ReportingRepository {
  /** Member headcount grouped by lifecycle status. */
  async membersByStatus(): Promise<StatusCount[]> {
    const rows = await MemberModel.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).exec();
    return rows.map((r) => ({ status: r._id, count: r.count }));
  }

  /** New members created on/after `since` (e.g. this month). */
  async newMembersSince(since: Date): Promise<number> {
    return MemberModel.countDocuments({ createdAt: { $gte: since } }).exec();
  }

  /** Outstanding (open) invoices grouped by currency, plus how many are in dunning ("to recover"). */
  async outstanding(): Promise<{ byCurrency: CurrencyTotal[]; toRecover: number }> {
    const grouped = await InvoiceModel.aggregate<{
      _id: string;
      count: number;
      totalMinor: number;
    }>([
      { $match: { status: 'open' } },
      {
        $group: {
          _id: '$currency',
          count: { $sum: 1 },
          totalMinor: { $sum: '$total.amountMinor' },
        },
      },
    ]).exec();
    const toRecover = await InvoiceModel.countDocuments({
      status: 'open',
      dunningStage: { $gte: 1 },
    }).exec();
    return {
      byCurrency: grouped.map((g) => ({
        currency: g._id,
        count: g.count,
        totalMinor: g.totalMinor,
      })),
      toRecover,
    };
  }

  /** Attendance counts grouped by calendar month (YYYY-MM), on/after `since`, oldest first. */
  async attendanceByMonth(since: Date): Promise<MonthCount[]> {
    const rows = await AttendanceModel.aggregate<{ _id: string; count: number }>([
      { $match: { occurredAt: { $gte: since } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$occurredAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).exec();
    return rows.map((r) => ({ month: r._id, count: r.count }));
  }

  /** Plan refs of every ACTIVE enrollment (the MRR base; priced in the app layer). */
  async activeEnrollmentPlanRefs(): Promise<EnrollmentPlanRef[]> {
    const docs = await EnrollmentModel.find({ status: 'active' })
      .select({ planId: 1, _id: 0 })
      .lean<{ planId: string }[]>()
      .exec();
    return docs.map((d) => ({ planId: d.planId }));
  }

  /** Pricing of every plan (id → price + interval), for MRR normalization in the app layer. */
  async planPricing(): Promise<PlanPricing[]> {
    const docs = await PlanModel.find()
      .select({ price: 1, interval: 1 })
      .lean<
        {
          _id: { toString(): string };
          price: { amountMinor: number; currency: string };
          interval: string;
        }[]
      >()
      .exec();
    return docs.map((d) => ({
      id: d._id.toString(),
      amountMinor: d.price.amountMinor,
      currency: d.price.currency,
      interval: d.interval,
    }));
  }

  /** Ids (as strings) of every ACTIVE member — the at-risk denominator. */
  async activeMemberIds(): Promise<string[]> {
    const docs = await MemberModel.find({ status: 'active' })
      .select({ _id: 1 })
      .lean<{ _id: { toString(): string } }[]>()
      .exec();
    return docs.map((d) => d._id.toString());
  }

  /** Distinct member ids that have any attendance on/after `since` — the at-risk exclusion set. */
  async attendeeIdsSince(since: Date): Promise<string[]> {
    const ids = await AttendanceModel.distinct('memberId', {
      occurredAt: { $gte: since },
    }).exec();
    return ids.map((id) => String(id));
  }
}
