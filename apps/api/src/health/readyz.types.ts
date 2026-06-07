/**
 * Readiness probe response. Each check is a coarse boolean a load balancer / orchestrator gates
 * traffic on, and reflects REAL state (no hardcoded true — audit F1). Only genuine HARD dependencies
 * appear: today that is Mongo (every request hits a tenant-scoped repository). More checks are added
 * as their dependencies become load-bearing for the api — `redis` once rate-limiting moves to a shared
 * store, `migrationsApplied` once the migration runner lands, `emailTransport` if email moves onto a
 * request's critical path. (`/healthz` stays dependency-free for liveness.)
 */
export interface ReadyzChecks {
  readonly mongo: boolean;
}

export interface ReadyzResponse {
  /** True only when every check below is true. */
  readonly ready: boolean;
  readonly checks: ReadyzChecks;
}

export interface HealthzResponse {
  readonly status: 'ok';
}
