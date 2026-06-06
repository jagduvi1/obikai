# 0004 — Multi-tenant isolation, auth & RBAC, tenant-global identity

**Status:** Accepted · 2026-06-06 · identity model decided with the product owner

## Context

Hosted Obikai serves many dojos from one deployment; self-host serves one (or, as an
association, several). `docs/scope.md` §7 warns that retrofitting tenant isolation is painful
and that the payer/guardian–student relationship is a hard modelling problem. The Glosan
reference enforced ownership with per-route `list.user === req.user.id` checks — one forgotten
check is a cross-dojo PII breach. We need isolation that is **structural, not conventional**.

## Decision

**Isolation — shared DB + mandatory indexed `tenantId`, enforced by the data layer:**

- A request-scoped `TenantContext` (tenantId, userId, roles, locationScope, requestId) lives in
  **AsyncLocalStorage**; a tenant-owned data access with **no context throws** (loud, never a
  silent cross-tenant read). Jobs/CLI/migrations must open context explicitly via
  `runInTenantContext`; "no context" is always a crash, "all tenants" is an explicit, audited
  `platform context` marker.
- A Mongoose `tenantGuard` plugin injects `tenantId` into queries and stamps it on writes.
  **Hardened against the holes a naive plugin leaves** (these are gating, each with a per-model
  leakage test):
  - Write paths Mongoose middleware misses — `insertMany`, `bulkWrite`, `upsert`
    (`$setOnInsert` must carry `tenantId`), `findOneAndDelete/Replace`, `replaceOne` — are
    stamped/scoped at the **repository layer**, not by trusting middleware.
  - Aggregations: a top-level `$match` is not enough — `$lookup`/`$unionWith`/`$graphLookup`
    join foreign collections **unfiltered**. The guard rewrites these to inject an inner tenant
    `$match`, **bans the `localField` `$lookup` form** and **`$merge`/`$out`** in tenant scope.
  - Uniqueness is **compound `{tenantId, field}}`** (per-tenant email, gapless invoice numbers
    via a per-tenant counter doc). An `explain()` test asserts hot queries use a
    tenantId-leading `IXSCAN`, never a `COLLSCAN`.

**Identity — tenant-global User, per-tenant Membership** (product owner decision: one login
across dojos): one human = one `User`/`Identity`, belonging to many dojos via `Membership`.
`User`/`Identity` are therefore **intentionally exempt** from `tenantGuard` (documented +
tested as deliberate); `Membership`, `Session`, `Guardianship`, and all GDPR queries scope to
the **resolved request tenant**, never the token's `tenantId` alone.

**Auth — self-hostable:** argon2id hashing; short-lived access JWT (carries tenantId, roles,
locationScope) via `jose`; opaque **rotating refresh** token hashed in DB with **reuse
detection** (theft → revoke the session family) → instant revoke for erasure/logout-all.
Sessions/rotation/revocation live in **one app-layer token service**; the `AuthPort` adapter
only *verifies identity* (local password, or optional OIDC via `openid-client`, never required).

**RBAC:** `(role, resource, action)` grants, location-scoped; roles owner/instructor/staff/
member/guardian; **guardian→minor is a `Guardianship` relationship edge**, not a role
(one guardian↔many minors, revocable). `can()` is a pure, deterministic, table-driven function;
CASL builds the same abilities for the UI but is never the security boundary. `award` on
`promotion` is human-only (invariant 4).

## Consequences

- Cross-tenant leakage requires actively bypassing a guarded seam, not merely forgetting a
  check — and the realistic leak vectors (bulk import, reporting joins) are closed.
- Controller/processor split (ADR-0007) maps cleanly: hosted = processor for member data,
  controller for owner accounts; self-host = dojo is controller.

## Alternatives considered

DB-per-tenant (connection sprawl, migration fan-out, divergent self-host runtime); per-route
ownership checks (Glosan's — one miss = breach); tenant-scoped users (duplicates identity for
cross-training students); a full ABAC/OPA engine (extra runtime, opaque). All rejected.
