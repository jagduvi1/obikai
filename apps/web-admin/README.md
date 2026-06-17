# @obikai/web-admin

The staff/owner admin UI for Obikai (ADR-0016). Vite + React + TypeScript SPA that talks to the
api, reusing `@obikai/domain` types across the wire.

## Develop

```bash
# from the repo root, with the api running on :3000
pnpm --filter @obikai/web-admin dev
```

Vite serves on `http://localhost:5173` and proxies `/api/*` to the api (set `VITE_API_TARGET` to
point elsewhere), so the httpOnly refresh cookie stays same-origin. In production the app is served
behind the same origin as the api, or set `VITE_API_URL`.

## Scripts

- `dev` — Vite dev server
- `build` — typecheck (`tsc --noEmit`) then `vite build`
- `test` — Vitest + Testing Library (jsdom)
- `typecheck` — types only

## Design

Wears the Obikai design system (`@obikai/ui`, ADR-0033): `main.tsx` imports
`@obikai/ui/styles.css` for the tokens, the Zen Kaku Gothic New display font, and
base element styling; `src/styles.css` layers the admin shell (brand-locked
top-nav with an active-tab accent underline, token-based tables/cards/forms).
Author against the CSS custom properties — never hard-code hex.

## Conventions

- Access token in memory; refresh via the api's httpOnly cookie (see `src/api/client.ts`).
- Server state via TanStack Query; typed bindings in `src/api/`.
- i18n (sv/nb/da/fi/en) in `src/i18n.ts`; WCAG 2.1 AA is an acceptance criterion (landmarks, labels,
  visible focus, `aria-live` errors) asserted in component tests.
