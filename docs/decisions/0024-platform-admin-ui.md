# 0024 — Platform-admin UI (`web-platform`)

**Status:** Accepted · 2026-06-07

## Context

The cross-tenant platform plane (ADR-0021/0022/0023) needs a UI for operators to use it: list/inspect
tenants, view usage, and read the audit log. The audience (platform operators) and the auth scope
(cross-tenant `PlatformGrant`, not a per-tenant membership) are fundamentally different from
`web-admin` (per-tenant dojo administration, tenant resolved from the Host).

## Decision

- **A separate Vite app, `apps/web-platform`** — not a section of `web-admin`. The two have different
  audiences, auth scopes, and API surfaces (`/platform/*` vs the tenant-scoped routes), and mixing
  cross-tenant operator views into the per-tenant admin would blur a security boundary. It mirrors the
  established frontend stack (ADR-0016): Vite + React 18 + TS, `@tanstack/react-query`,
  `react-i18next`, the shared `@obikai/api-client`, WCAG 2.1 AA, served as a static SPA by Caddy with
  the same TS-generated CSP/security headers (ADR-0008).
- **Auth reuses the tenant-independent access token.** Login goes through the same `/auth` flow (the
  JWT carries no tenant); the UI never decides platform access — the api's `PlatformMiddleware`
  enforces the `PlatformGrant` and a 403 surfaces as a per-page error. Bootstrap is the api CLI
  `grant-platform-admin <email>`.
- **Read-only screens:** Tenants (list), Tenant detail (registry record + usage counts), Audit log
  (the hash-chained platform read trail, newest-first). No mutation — matching the read-only v1 plane.
- **Build/CI parity:** its own `docker/web-platform.Dockerfile` (static SPA → Caddy, `caddy validate`
  gate) and a `web-platform` entry in the CI Docker matrix, exactly like `web-admin`/`web-member`.

## Consequences

- Operators get a usable console for the oversight plane built in ADR-0021–0023, completing the
  platform-admin epic's UI.
- The separation keeps the per-tenant and cross-tenant UIs independently deployable and their CSPs/
  origins distinct; a future hosted deployment can put `web-platform` on its own operator hostname.
- The app imports `@obikai/domain` types only (erased at build) + `@obikai/api-client`, so the
  import-boundary rules (ADR-0003) hold and there is no runtime coupling to server packages.

## Alternatives considered

- **A guarded section inside `web-admin`**: rejected — `web-admin` is per-tenant (Host-resolved); the
  platform plane is cross-tenant with a different grant. Co-locating them would entangle two security
  scopes and two API surfaces in one bundle.
- **Client-side chain verification on the Audit page**: deferred — `verifyPlatformAuditChain` lives in
  `@obikai/db` (server), which web apps must not import (ADR-0003). Verification stays a server/CLI
  concern; the UI displays the trail.
