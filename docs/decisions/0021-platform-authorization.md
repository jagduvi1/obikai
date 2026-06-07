# 0021 — Platform (cross-tenant) authorization model

**Status:** Accepted · 2026-06-07

## Context

The operator needs a **cross-tenant oversight plane** — one principal that can see across all tenants
(tenant list/inspect, usage, platform audit) — requested as "one role that handles all tenants". This
is the deliberately-separate counterpart to per-tenant RBAC (ADR-0004): cross-tenant authority must
never be confused with, or derivable from, a tenant `owner` role. v1 is **read-only oversight**: it
observes, it never mutates tenant data. This ADR is the authorization *model*; the `/platform` HTTP
plane and UI follow in subsequent PRs. It builds on the tenant registry (ADR-0017) and the
`runAsPlatform(...)` marker (ADR-0004).

## Decision

- **A separate platform vocabulary** in `@obikai/domain/platform.ts`: `PLATFORM_ROLES`
  (`platform_admin` only for now), `PLATFORM_RESOURCES` (`tenant`/`usage`/`auditLog`), and
  `PLATFORM_ACTIONS` (`read`/`list` — **read-only by construction in v1**). Kept wholly distinct from
  the tenant `RESOURCES`/`ACTIONS`/`ROLES` so a tenant grant can never satisfy a platform check and
  vice-versa.
- **`PlatformGrant` ties a tenant-global `User` to a platform role** — completely separate from any
  per-tenant `Membership`. A user with no grant has **no** platform access. Persisted by a
  TENANT-GLOBAL `PlatformGrant` collection (exempt from `tenantGuard`, like `User`/`Tenant`,
  ADR-0017); `findByUserId` resolves at the request boundary before any context exists (mirroring
  `MembershipRepository.resolveForRequest`). One grant per user (unique `userId`, idempotent upsert).
- **`canPlatform(actor, permission)`** in `@obikai/authz` is the pure, deterministic platform
  boundary, with a code-defined `DEFAULT_PLATFORM_PERMISSIONS` catalog (`platform_admin` → every
  read/list) — the exact shape of `can()`/`DEFAULT_ROLE_PERMISSIONS`, so it is equally testable and
  versioned.

## Consequences

- The next PR can build `/platform/*` endpoints: a platform-auth guard resolves the `PlatformGrant`,
  opens `runAsPlatform(...)`, and authorizes each handler with `canPlatform`. Those routes are
  excluded from the tenant `TenancyMiddleware` (which requires a resolved tenant).
- Read-only-by-vocabulary means even a bug in a platform handler cannot mutate tenant data — there is
  no platform `create`/`update`/`delete` action to call.
- Extensible: more platform roles (e.g. `platform_support`) or write actions can be added later by
  widening the vocabulary + catalog, without touching tenant RBAC.

## Alternatives considered

- **Reuse the tenant `owner` role across tenants**: rejected — it conflates tenant and platform
  authority, and a tenant owner must never gain cross-tenant reach. Separate vocabularies make the
  boundary structural.
- **A boolean `isPlatformAdmin` flag on `User`**: rejected — no room for roles/audit/extension, and it
  couples platform authority into the identity record rather than an explicit, revocable grant.
- **Allow write actions in v1**: rejected — the user scoped v1 to read-only oversight; omitting write
  actions from the vocabulary makes "never mutates tenant data" a compile-time guarantee, not a
  convention.
