# @obikai/web-platform

The **platform operator console** (ADR-0024): a cross-tenant, read-only oversight UI for Obikai
operators. Distinct from `web-admin` (per-tenant dojo administration) — this app talks to the
`/platform/*` plane (ADR-0022) and requires a `PlatformGrant` (ADR-0021), enforced server-side.

- **Tenants** — list every tenant, inspect one, view per-tenant usage counts.
- **Audit log** — the tamper-evident, hash-chained record of platform reads (ADR-0023).

Stack mirrors `web-admin` (Vite + React 18 + TypeScript, `@tanstack/react-query`, `react-i18next`,
the shared `@obikai/api-client`, WCAG 2.1 AA). Auth uses the tenant-independent access token; whether
the signed-in user has platform access is decided by the api, not the UI.

Dev: `pnpm --filter @obikai/web-platform dev` (port 5175; proxies `/api` → `localhost:3000`).
Bootstrap a platform admin with the api CLI: `obikai grant-platform-admin <email>`.
