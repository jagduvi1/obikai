/**
 * Owner dashboard / reporting shapes (scope §4.9). The API computes these from tenant-guarded
 * aggregations; the admin SPA renders them. Money is per-currency (a tenant may, in principle, hold
 * more than one) and always integer minor units — never mix currencies in a single sum.
 */

export interface ReportMoney {
  readonly currency: string;
  readonly amountMinor: number;
}
export interface ReportStatusCount {
  readonly status: string;
  readonly count: number;
}
export interface ReportMonthCount {
  /** Calendar month as `YYYY-MM`. */
  readonly month: string;
  readonly count: number;
}

/** The action-oriented owner dashboard payload (§4.9). */
export interface OwnerDashboard {
  readonly members: {
    readonly active: number;
    readonly newThisMonth: number;
    readonly byStatus: readonly ReportStatusCount[];
  };
  readonly revenue: {
    /** Monthly recurring revenue from active enrollments, normalized per billing interval. */
    readonly mrr: readonly ReportMoney[];
    /** Open (unpaid) invoice totals. */
    readonly outstanding: readonly ReportMoney[];
    readonly outstandingCount: number;
    /** Open invoices already in dunning — "payments to recover". */
    readonly toRecover: number;
  };
  /** Active members with no attendance in the at-risk window (a churn early-warning). */
  readonly atRisk: number;
  /** Attendance counts per month over the trailing window. */
  readonly attendanceTrend: readonly ReportMonthCount[];
  readonly generatedAt: string;
}
