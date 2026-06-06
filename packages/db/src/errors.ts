/**
 * Typed failures for the multi-tenant isolation seam (ADR-0004). Each is a distinct class so the
 * app/worker can map it to the right HTTP status and, crucially, so a missing or violated tenant
 * scope is ALWAYS a loud crash — never a silent cross-tenant read or write.
 */

/**
 * Thrown when tenant-owned data access is attempted with no `TenantContext` on the async stack.
 * "No context" is a programmer error (a job/CLI/migration forgot `runInTenantContext`), so it must
 * crash loudly rather than fall back to an unscoped — and therefore cross-tenant — query.
 */
export class MissingTenantContextError extends Error {
  constructor(detail = 'No TenantContext is active on the current async stack') {
    super(
      `${detail}. Tenant-owned data access requires runInTenantContext(...) or an explicit runAsPlatform(...) block. "No context" is never silently treated as "all tenants".`,
    );
    this.name = 'MissingTenantContextError';
  }
}

/**
 * Thrown by `pre('save')` when a document already carries a `tenantId` that differs from the active
 * context's — i.e. an attempt to write one tenant's document while scoped to another.
 */
export class CrossTenantWriteError extends Error {
  constructor(expected: string, found: string) {
    super(
      `Cross-tenant write blocked: document tenantId="${found}" does not match active ` +
        `context tenantId="${expected}".`,
    );
    this.name = 'CrossTenantWriteError';
  }
}

/**
 * Thrown by the aggregation guard when a stage cannot be made tenant-safe: the `localField`/
 * `foreignField` form of `$lookup` (which joins a foreign collection unfiltered, with no pipeline
 * to inject a `$match` into), or the `$merge`/`$out` stages (which write to arbitrary collections
 * and so are banned inside tenant scope).
 */
export class UnsafeAggregationError extends Error {
  constructor(detail: string) {
    super(`Unsafe aggregation stage blocked by tenantGuard: ${detail}`);
    this.name = 'UnsafeAggregationError';
  }
}

/**
 * Thrown when the platform marker context is queried for a `tenantId` (it intentionally has none),
 * or when a tenant-scoped helper is reached while running under `runAsPlatform`. Cross-tenant work
 * must use explicitly platform-aware code paths, never the tenant-scoped guard/repository.
 */
export class PlatformContextError extends Error {
  constructor(detail = 'The active context is the platform (cross-tenant) marker') {
    super(
      `${detail}. The platform context has no tenantId; use a platform-aware code path for cross-tenant operations, not the tenant-scoped guard or repository.`,
    );
    this.name = 'PlatformContextError';
  }
}
