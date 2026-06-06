/**
 * Readiness probe response. Each check is a coarse boolean a load balancer / orchestrator can
 * gate traffic on. `emailTransport` is included deliberately (ADR-0009): a first-boot SMTP
 * misconfiguration must be observable, not silent, since email-independent owner bootstrap is the
 * only lockout escape hatch.
 */
export interface ReadyzChecks {
  readonly mongo: boolean;
  readonly redis: boolean;
  readonly migrationsApplied: boolean;
  readonly emailTransport: boolean;
}

export interface ReadyzResponse {
  /** True only when every check below is true. */
  readonly ready: boolean;
  readonly checks: ReadyzChecks;
}

export interface HealthzResponse {
  readonly status: 'ok';
}
