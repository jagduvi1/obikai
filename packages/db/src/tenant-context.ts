/**
 * Request-scoped tenant context (ADR-0004). Isolation is structural, not conventional: the active
 * tenant lives in `node:async_hooks` `AsyncLocalStorage`, the `tenantGuard` plugin and
 * `TenantRepository` read it implicitly, and tenant-owned data access with NO context throws
 * loudly (`MissingTenantContextError`). Two escape hatches, both explicit:
 *
 *  - `runInTenantContext(ctx, fn)` — open a normal, single-tenant scope (HTTP requests, jobs, CLI).
 *  - `runAsPlatform(fn)` — an explicit, audited cross-tenant marker. "No context" is ALWAYS a
 *    crash; "all tenants" is NEVER implicit — it must be this marker.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Tenancy } from '@obikai/config';
import type { RoleAssignment } from '@obikai/domain';
import { MissingTenantContextError, PlatformContextError } from './errors.js';

/**
 * The data carried for the duration of one logical operation. Fields are set programmatically at
 * the trust boundary (HTTP/job entry), so they use `| null` rather than optionals (per repo
 * convention + `exactOptionalPropertyTypes`): a field is present-and-known or present-and-null.
 */
export interface TenantContext {
  /** The resolved request tenant — NEVER trusted from a token's `tenantId` alone (ADR-0004). */
  readonly tenantId: string;
  /** The acting user (tenant-global identity), or null for unauthenticated/system flows. */
  readonly userId: string | null;
  /** The session this operation runs under, or null outside an authenticated session. */
  readonly sessionId: string | null;
  /** Role assignments the actor holds in THIS tenant (per-role location scope); used by `can()`. */
  readonly roles: readonly RoleAssignment[];
  /** The actor's member id in this tenant (enables self-access in `can()`), or null. */
  readonly memberId: string | null;
  /** Correlation id for tracing/audit across the async stack. */
  readonly requestId: string;
  /** Which tenancy axis the deployment runs (single self-host vs multi hosted) — ADR-0002. */
  readonly tenancy: Tenancy;
}

/**
 * Discriminator distinguishing a real tenant scope from the explicit platform (cross-tenant)
 * marker. Stored internally so the guard/repository can refuse to silently scope platform work.
 */
type Scope =
  | { readonly kind: 'tenant'; readonly ctx: TenantContext }
  | { readonly kind: 'platform' };

const storage = new AsyncLocalStorage<Scope>();

/**
 * Run `fn` with `ctx` as the active tenant scope. Use at every entry point that owns tenant data:
 * HTTP requests (after resolving the request tenant), queue jobs, CLI commands, and migrations.
 */
export function runInTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run({ kind: 'tenant', ctx }, fn);
}

/**
 * Run `fn` under the explicit platform (cross-tenant) marker. This is the ONLY sanctioned way to
 * touch many tenants at once (platform admin, billing rollups, per-tenant migration drivers). It is
 * deliberately separate from `runInTenantContext` so cross-tenant access is always visible and
 * auditable in code review, never an accidental side effect of a forgotten scope.
 */
export function runAsPlatform<T>(fn: () => T): T {
  return storage.run({ kind: 'platform' }, fn);
}

/** True when running inside an explicit platform (cross-tenant) marker block. */
export function isPlatformContext(): boolean {
  return storage.getStore()?.kind === 'platform';
}

/**
 * The active `TenantContext`, or throw. The guard and repository call this for every tenant-owned
 * operation: a missing scope (`MissingTenantContextError`) or the platform marker
 * (`PlatformContextError`) are both loud failures, never a silent unscoped query.
 */
export function getTenantContextOrThrow(): TenantContext {
  const scope = storage.getStore();
  if (scope === undefined) throw new MissingTenantContextError();
  if (scope.kind === 'platform') throw new PlatformContextError();
  return scope.ctx;
}

/** The active `TenantContext`, or null if none / platform. Non-throwing form for opt-in callers. */
export function getTenantContext(): TenantContext | null {
  const scope = storage.getStore();
  if (scope === undefined || scope.kind === 'platform') return null;
  return scope.ctx;
}

/** The active tenantId, or throw — the single value the guard injects into queries/writes. */
export function getTenantIdOrThrow(): string {
  return getTenantContextOrThrow().tenantId;
}
