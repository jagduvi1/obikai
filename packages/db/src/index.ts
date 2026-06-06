/**
 * @obikai/db — the multi-tenant isolation seam (ADR-0004). Tenant scope lives in
 * `AsyncLocalStorage`; the `tenantGuard` Mongoose plugin and `TenantRepository` read it implicitly
 * so cross-tenant leakage requires actively bypassing a guarded seam, not merely forgetting a
 * check. Depends only on `@obikai/domain` + `@obikai/config` + `mongoose` (ADR-0003).
 */
export * from './errors.js';
export * from './tenant-context.js';
export * from './tenant-guard.js';
export * from './repository.js';
export * from './migrate.js';
export * from './connection.js';
export * from './member.js';
export * from './household.js';
export * from './auth.js';
