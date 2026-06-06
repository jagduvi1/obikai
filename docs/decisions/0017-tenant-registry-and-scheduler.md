# 0017 — Tenant registry & recurring-billing scheduler

**Status:** Accepted · 2026-06-06

## Context

Two gaps blocked the platform from running billing unattended and blocked the (deferred) read-only
platform-admin plane:

1. There was no **registry of tenants**. Tenant identity was resolved per-request from the Host
   header (multi) or `selfHostTenantSlug` (single) — ADR-0004 — but nothing enumerated *which*
   tenants exist. Cross-tenant operations (a nightly billing sweep, a future platform-admin overview)
   had no list to iterate.
2. The worker (ADR-0001) could *process* `billing-run`/`dunning` jobs but nothing *enqueued* them on
   a schedule — there was no producer and no recurring trigger.

The recurring-billing/dunning logic itself already exists and is idempotent (ADR-0013): the only
missing piece is a safe, cross-tenant **fan-out** that respects the isolation invariants (ADR-0004:
"all tenants" is never implicit; it must be the explicit `runAsPlatform(...)` marker).

## Decision

- **`Tenant` is a tenant-global registry entity.** New `@obikai/domain` `Tenant`
  (`slug`/`name`/`status`) + `TENANT_STATUSES` (`active`/`suspended`/`archived`) +
  `tenantSlugSchema` (DNS-label-safe). Persisted by `@obikai/db` `TenantModel` /
  `TenantRegistryRepository`. Like `User`/`Identity`/`Session` (ADR-0004/0012) it is the registry
  *of* tenants, not data *owned by* one, so it is **deliberately exempt from `tenantGuard`** (asserted
  in `test/tenant.test.ts`: the schema has no `tenantId` path).
- **The slug is the key, stored as `_id`.** `id === slug === tenantId` (the value the Host-header
  middleware resolves and stamps into every scoped context/job). Uniqueness is the primary key — no
  extra index, and re-registering a slug is a no-op.
- **Enumeration requires the platform marker.** Single-slug ops (`findBySlug`/`create`/
  `ensureRegistered`/`updateStatus`) work in any context; the cross-tenant `list`/`listActive`
  **throw `PlatformContextError` unless inside `runAsPlatform(...)`**. Cross-tenant reads are never
  implicit, even though the collection is unguarded.
- **Self-host registers itself at bootstrap.** `create-owner` (ADR-0009) calls
  `ensureRegistered({ slug: selfHostTenantSlug, name: slug })` — idempotent, so re-running never
  mutates an existing tenant. (The hosted plane will register tenants at signup in a later PR.)
- **The worker is also a producer + scheduler.** A separate vocabulary of **platform jobs**
  (`PLATFORM_JOB_NAMES = ['billing-tick']`, tenant-less `PlatformJobData`) sits alongside the
  tenant-scoped `JOB_NAMES`, so a platform job can never be routed through the path that demands a
  `tenantId`. `main.ts` opens a dedicated producer `Queue` (its own Redis connection — a `Worker`
  blocks on its connection) and registers the daily tick via `queue.upsertJobScheduler` (idempotent:
  restarts update, never stack duplicates).
- **The tick fans out under `runAsPlatform`.** `handleJob` dispatches `billing-tick` **before** the
  tenantId guard: it opens `runAsPlatform`, lists active tenants, and enqueues a per-tenant
  `billing-run` + `dunning` (each carrying a `tenantId`) which the worker then processes in
  `runInTenantContext` exactly as any other scoped job. The fan-out logic lives in framework-free
  `scheduler.ts#runBillingTick` (tenant source + enqueuer interfaces) so it unit-tests with no
  Redis; per-tenant failures are isolated and logged, never aborting the sweep.

## Consequences

- A nightly tick (default cron `0 2 * * *`) now drives recurring billing across every active tenant
  with no human action, while honoring tenant isolation: the only cross-tenant step is the explicit,
  auditable `runAsPlatform` list; all actual billing runs scoped.
- The registry is the foundation the deferred **read-only platform-admin** plane builds on (tenant
  list/inspect/usage) without re-deriving "which tenants exist".
- Idempotency stacks cleanly: `upsertJobScheduler` (no duplicate schedules) → `runBillingTick`
  (re-delivery re-enqueues) → `billRecurringForEnrollment`/`advanceDunning` (idempotent at the
  service layer, ADR-0013), so a re-delivered tick never double-bills.
- **In-process hosting caveat:** when `runWorkerInProcess` (ADR-0002) is later wired so the api hosts
  the worker, the same `upsertJobScheduler` registration must run there too. Because it is idempotent
  this is safe; it is simply not yet wired (the api does not host the worker in-process today).

## Alternatives considered

- **Derive the tenant list from existing collections** (e.g. distinct `tenantId`s across guarded
  data) instead of a registry: rejected — it can't represent a tenant with no data yet, has no place
  for lifecycle `status`/display name, and would force a cross-tenant scan the guard is designed to
  forbid.
- **A sentinel `tenantId` on the tick job** to reuse the tenant-scoped path: rejected — it would
  smuggle a fake tenant through the isolation seam. A separate platform-job vocabulary keeps the
  "no tenantId ⇒ platform, explicit marker" rule structural.
- **Register the schedule in the api rather than the worker:** rejected for now — the worker is the
  always-on consumer and is meant to run standalone (ADR-0001); co-locating producer + schedule keeps
  it self-contained. The idempotent upsert means moving/duplicating it later is harmless.
- **BullMQ legacy repeatable jobs (`repeat` on `add`)** instead of Job Schedulers: rejected —
  `upsertJobScheduler` is the current API and is idempotent across restarts by design.
