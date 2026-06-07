# 0022 — Platform HTTP plane (`/platform/*`)

**Status:** Accepted · 2026-06-07

## Context

With the platform authorization model in place (ADR-0021), the read-only oversight plane needs an
HTTP surface: a platform admin authenticates once (no tenant), lists/inspects all tenants, and reads
per-tenant usage — all under the explicit `runAsPlatform(...)` marker (ADR-0004), never a tenant
context. The challenge is the request plane: the existing `TenancyMiddleware` resolves a tenant from
the Host and opens `runInTenantContext`, which is exactly wrong for cross-tenant work.

## Decision

- **A dedicated `PlatformMiddleware` for `/platform/*`.** It authenticates the user from the access
  token (the JWT is tenant-independent — `{sub,sid}` only, ADR-0012), requires a `PlatformGrant`
  (`findByUserId`, tenant-global so it is safe to read before any context exists), and then runs the
  whole request under `runAsPlatform(() => next())`. Context is opened in **middleware**, not a guard,
  because the AsyncLocalStorage scope must wrap the entire downstream stack (guards/controllers).
  401 (no/invalid token) and 403 (no grant) are decided by the pure, unit-tested `decidePlatformAccess`.
- **`TenancyMiddleware` excludes `platform/(.*)`** so the two middlewares never overlap; a platform
  request never gets a tenant context, a tenant request never gets the platform scope.
- **Per-endpoint authorization via `canPlatform`** (ADR-0021) on the resolved actor (stashed on the
  request by the middleware). Endpoints: `GET /platform/tenants` (list), `GET /platform/tenants/:slug`
  (inspect), `GET /platform/tenants/:slug/usage` (counts). All read-only.
- **Usage reads scope INTO the tenant.** The platform plane can't use a guarded repository directly
  (the guard refuses platform context — by design). To count a tenant's members the handler briefly
  opens `runInTenantContext(slug)` and calls the normal `MemberRepository.count()` — an explicit,
  auditable platform→tenant read, scoped to exactly that one tenant.
- **Bootstrap via CLI** `grant-platform-admin <email>` (mirrors `create-owner`): resolves an existing
  user by email and writes a tenant-global `PlatformGrant`. No tenant context needed.

## Consequences

- Operators get cross-tenant oversight with the same JWT they already hold; access is an explicit,
  revocable grant, not a tenant role.
- "Never mutates tenant data" holds at three layers: no platform write action exists (ADR-0021), the
  endpoints are all GETs, and even the usage read scopes into a single tenant through the normal guard.
- The nested-context pattern (`runAsPlatform` outer, `runInTenantContext(slug)` inner for a specific
  read) is the sanctioned way for the platform plane to inspect one tenant's data without weakening
  isolation.

## Follow-ups (not in this ADR)

- A **platform audit log** (record who inspected what) — the `@obikai/gdpr` hash-chained audit port
  exists but is not yet wired into db/api, and it is tenant-scoped; a cross-tenant platform stream is
  its own decision.
- The **platform-admin UI**.
- Access-token **session-revocation** checks are out of scope here (access tokens are short-lived;
  revocation is enforced at refresh, ADR-0012) — same posture as `TenancyMiddleware`.

## Alternatives considered

- **A guard instead of middleware**: rejected — guards run after middleware and inside whatever ALS
  scope middleware already set; the platform scope must be opened to wrap the whole request.
- **Reuse TenancyMiddleware with a "platform" pseudo-tenant**: rejected — it would smuggle platform
  work through the tenant path; a separate middleware keeps "no tenant, explicit `runAsPlatform`"
  structural.
- **Raw cross-tenant aggregation for usage**: rejected for v1 — scoping into the tenant via the
  existing guard is simpler and reuses the audited isolation seam.
