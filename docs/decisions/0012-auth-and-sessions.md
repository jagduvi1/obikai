# 0012 — Authentication & session model

**Status:** Accepted · 2026-06-06

## Context

ADR-0004 set the direction: self-hostable auth (no SaaS required), argon2id-class hashing, short
access JWT + rotating refresh with reuse detection, and **tenant-global identity** (one human, one
login, many dojos via per-tenant `Membership`). This ADR fixes how the access token, sessions, and
per-request role resolution actually work, now that the Members vertical needs a real actor.

## Decision

- **Identity is tenant-global; authorization is per-request-tenant.** Login authenticates the
  `User` (global). The **access token carries only `{ sub: userId, sid: sessionId }`** — NOT a
  tenant or roles. Each request resolves its tenant from the host (ADR-0004), then loads
  `Membership(userId, resolvedTenant)` to get `roles` + `memberId`, which populate the
  `TenantContext`. One token therefore works across all the user's dojos; roles are always those of
  the **resolved** tenant (never the token's word). No membership for the resolved tenant ⇒
  authenticated but role-less ⇒ `can()` denies (safe default).
- **Password verification goes through the `auth-local` adapter** (`AuthPort`, ADR-0003), backed by
  a db `IdentityStore` that creates the tenant-global `User` + local `Identity`. Sessions/tokens are
  the app's `TokenService`, never the adapter (so a future OIDC adapter doesn't touch session code).
- **Access token:** signed JWT via `jose` (HS256 over `AUTH_JWT_SECRET`), short TTL
  (`ACCESS_TOKEN_TTL`, default 15m).
- **Refresh token:** opaque 256-bit random, returned to the client once, stored only as a SHA-256
  **hash** in a `Session`. Rotated on every use; each rotation belongs to a `family`. A retired
  token's row is **kept (marked revoked), not deleted**. **Reuse detection:** presenting a token
  that is found-but-revoked revokes the whole family (a stolen, already-rotated token can't be
  replayed). Retirement is an **atomic compare-and-swap** (`revokeIfActive`), so two concurrent
  rotations of the same token cannot both succeed — the loser is treated as reuse and the family is
  killed. Refresh delivered to web as an httpOnly+SameSite=strict cookie whose `Secure` flag is
  derived from config (on except local-dev `baseDomain`), not per-request `req.secure`; native
  clients use secure storage. A coarse per-IP rate limit guards `/auth` (brute-force + scrypt-DoS).
- **Tenancy-global collections** (`User`, `Identity`, `Session`) are intentionally EXEMPT from
  `tenantGuard` (ADR-0004) — documented and asserted by a test so the exemption is deliberate, not
  accidental. `Membership` IS tenant-scoped (guarded; unique `{tenantId, userId}`).
- **`TenantContext` evolves** to carry `roles: RoleAssignment[]` (per-role location scope) and
  `memberId: string | null` (enables self-access in `can()`), replacing the coarse single
  `locationScope` field.
- **Email-independent owner bootstrap** (`obikai create-owner`, ADR-0009): creates `User` +
  `Identity` + an `owner` `Membership` for the self-host tenant, so first login never depends on
  email delivery.

## Consequences

- **Role changes take effect on the next request** (roles are re-resolved per request from the
  Membership). **Refresh-token revocation is immediate** (server-side state). **Access-token
  revocation is bounded by `ACCESS_TOKEN_TTL`** (default 15m): a logged-out/role-revoked user's
  already-issued access token remains valid until it expires — keep the access TTL short.
- Refresh-token theft is detected on the next legitimate use (or any concurrent use) → family revoke.

### Tracked follow-ups (primitives exist; wiring lands in later slices)

- **logout-all & on-suspend/password-change revocation:** `SessionRepository.revokeAllForUser`
  exists but is not yet wired to an endpoint/flow.
- **GDPR erasure (ADR-0007):** `IdentityRepository.deleteByUserId` + `revokeAllForUser` +
  `UserRepository.deleteById` exist; the erasure *service* that calls them (hard-delete Identity,
  revoke Sessions, anonymize/erase per the ROPA policy) is built in the GDPR slice.
- **Access-token liveness / global `User.status` enforcement at the request boundary** (would make
  suspend/logout immediate at the cost of a per-request session/user lookup) — deferred; the short
  access TTL bounds the window today.

## Alternatives considered

Tenant-embedded access tokens (force re-login per dojo; wrong for one-login-many-dojos);
stateless-JWT-only refresh (no revocation — unacceptable with right-to-erasure); putting sessions
in the auth adapter (couples session logic to the provider). All rejected.
