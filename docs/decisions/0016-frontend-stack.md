# 0016 — Frontend stack (web-admin / web-member)

**Status:** Accepted · 2026-06-06

## Context

Phase 2+ needs member-facing and admin UIs (scope §9). They must be TypeScript end-to-end
(invariant 8), reuse the shared `@obikai/domain` types across the wire, meet WCAG 2.1 AA and i18n
(sv/nb/da/fi/en) from day one (invariant 6), and run in both deploy modes behind the same api.

## Decision

- **Vite + React 18 + TypeScript**, one app per audience: `apps/web-admin` (this ADR's foundation)
  and `apps/web-member` (PWA, later). Strict tsconfig with bundler resolution; no `tsc -b` graph —
  each app is a leaf that imports `@obikai/domain` **types only** (erased at build), so there is no
  runtime coupling to server packages and the import-boundary rules (ADR-0003) still hold.
- **Routing:** `react-router-dom`. **Server state:** `@tanstack/react-query` (caching, retries,
  loading/error states) over a small **typed `fetch` client** — not a generated SDK, since the api
  has no OpenAPI spec yet and hand-written bindings reuse the domain types directly.
- **Auth:** access token in memory only (never `localStorage` — XSS hygiene); the refresh token is
  the api's **httpOnly cookie**. The client transparently calls `POST /auth/refresh` once on a 401
  and retries. In dev, Vite proxies `/api` to the api so the cookie stays same-origin (no CORS
  credential dance); in prod the app is served behind the same origin (or `VITE_API_URL`). Tenant is
  resolved by the api from the Host header (ADR-0004), so the browser sends nothing extra.
- **i18n:** `react-i18next`, English source + Nordic locales, namespaced keys; locale-aware
  dates/numbers/currency via `Intl`.
- **Accessibility:** semantic landmarks, a skip link, labelled controls, `aria-live` errors, and
  visible `:focus-visible` styling are baseline; a11y is an acceptance criterion, asserted in
  component tests (`@testing-library` queries by role/label).
- **Testing:** Vitest + Testing Library in jsdom; the api client's refresh-and-retry logic is unit
  tested with a mocked `fetch`.
- **Styling:** plain CSS with design tokens (CSS variables) for the foundation; a richer component
  system (e.g. Radix primitives) can be layered later without re-architecting.

## Consequences

- The admin renders exactly the shapes the api returns — a type error surfaces if a domain type and
  its usage drift, the payoff of the TS-end-to-end monorepo.
- No SSR/Next.js: these are authenticated SPAs behind auth, so SEO/SSR isn't needed; this keeps the
  self-host footprint to static assets served by any web server (invariant 10).
- A generated client + OpenAPI spec is a future option; until then the hand-written bindings are the
  single typed seam to keep in sync (small, and covered by tests).
