# @obikai/web-member

The member-facing PWA for Obikai (ADR-0016). A Vite + React installable app that shows a member
their own martial-arts journey — rank progress, promotions, and invoices — reusing the shared
`@obikai/api-client` and `@obikai/domain` types.

## Develop

```bash
# from the repo root, with the api running on :3000
pnpm --filter @obikai/web-member dev   # serves on http://localhost:5174, proxies /api
```

## What it shows

- **My progress** — per-discipline rank eligibility (ready / almost there / keep training, with
  per-criterion "how close") and promotion history. All via the api's self-access endpoints
  (`ownerMemberId === me`), so a member only ever sees their own data.
- **My invoices** — the member's billing history, locale-formatted.

## PWA

Installable via `public/manifest.webmanifest`; `public/sw.js` is a minimal network-first service
worker (registered in production) for an offline app-shell fallback. API calls are never cached. A
richer precaching strategy (workbox) can replace it later.

## Design

Phone-first, wearing the Obikai design system (`@obikai/ui`, ADR-0033):
`main.tsx` imports `@obikai/ui/styles.css` (tokens + the Zen Kaku Gothic New
display font); `src/styles.css` adds the mobile shell — a slim brand header, a
scrollable main, and a bottom tab bar (text-only tabs, ≥44px touch targets; the
product ships no icon set). Booking/invoice status render as `Badge`s; tables
tighten under 700px. Dark-only; author against the CSS custom properties.

## Conventions

Same as web-admin: access token in memory + httpOnly refresh cookie (shared client), TanStack Query
for server state, i18n (sv/nb/da/fi/en), WCAG 2.1 AA (landmarks, labels, visible focus).
