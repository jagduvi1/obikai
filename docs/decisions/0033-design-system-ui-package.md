# 0033 — A shared design-system package (`@obikai/ui`)

**Status:** Accepted · 2026-06-15

## Context

A Claude Design handoff bundle (`Obikai Design System`) formalized the product's
visual language — a quiet, dark, high-trust admin instrument: one accent blue
(violet on the platform surface), an amber focus ring, the **Zen Kaku Gothic New**
display face (OFL) for headings/wordmark with `system-ui` body, borders that
define cards (not shadows), no gradients except the functional belt bands,
sentence case, no emoji, and the rank vocabulary made visible as components
(BeltChip, CriteriaMeter, CriterionTag, …). "Belt is a presentation type, not an
assumption."

Until now the three frontends (`web-admin`, `web-member`, `web-platform`) each
carried a near-identical hand-rolled `src/styles.css` that defined a small subset
of these tokens (`--bg`, `--surface`, …) and no shared components. The design
system's source notes that the product historically shipped "no shared UI
package — the apps are deliberately dependency-light." Adopting the full token
set, the font, and 11 components across three apps under that rule would mean
triplicating all of it and letting the copies drift.

## Decision

Introduce **`packages/ui` (`@obikai/ui`)** as the single source of truth for the
design system:

- **Token CSS** — `tokens/{colors,typography,spacing,base}.css` + `fonts.css`
  (the `@font-face` for the display face), behind one `styles.css` entry that
  `@import`s them. Lifted verbatim from the handoff (which itself was derived
  from the apps' former `styles.css`).
- **The display font** — the Zen Kaku Gothic New TTFs (Bold 700 / Black 900) and
  their OFL license, vendored under `assets/fonts/`. OFL is AGPL-compatible.
- **The brand mark** — `assets/obikai-mark.svg`, also inlined as `<BrandMark>` /
  `<BrandLockup>` so headers need no asset-pipeline wiring (and it renders in
  tests).
- **11 component primitives** ported to strict TypeScript from the handoff's
  JSX, styled purely with the CSS custom properties (forms: Button / TextField /
  Select; display: Badge / StatCard / Avatar; rank: BeltChip / CriteriaMeter /
  CriterionTag; scheduling: ClassCard; billing: InvoiceDocument).

**Consumed as source, not built.** The package's `exports` point at the `.ts`/
`.css` source; the Vite apps transpile it directly (no `tsc -b`/`dist` step,
unlike the leaf logic packages). This keeps the CSS + font assets resolvable
through Vite's pipeline and avoids a bundler in the package. Its own `typecheck`
script (strict, with `noUnusedLocals`/`exactOptionalPropertyTypes`) and the apps'
`tsc --noEmit` both cover it.

**It is a framework-light leaf.** `@obikai/ui` depends only on `react` (peer) and
nothing else in the workspace. The ESLint boundaries graph (ADR-0003) gains a
`ui` element with `allow: []`, and `app → ui` is permitted.

**No vendor lock-in / invariants preserved.** Dark-only (paper invoices are the
one light surface, via `InvoiceDocument variant="paper"`); display face for
headings/wordmark only, body stays `system-ui`; one accent blue + amber focus
ring; the platform app overrides `--color-accent` to the brand violet. The apps'
own `src/styles.css` now imports `@obikai/ui/styles.css` first and layers only
surface-specific rules (the admin/platform top-nav shell, the member phone shell)
on top.

This is a deliberate deviation from the "no shared UI package" guideline,
recorded here per CLAUDE.md (own the module boundaries; note deviations). It
removes triplication rather than adding a heavy dependency — the package ships no
runtime deps of its own.

## Consequences

- **One place to evolve the design language.** Token or component changes land
  once and reach all three apps. The reskin was visual-only: routing, data flow,
  i18n keys, and the (role/text-based) test suites are unchanged and green.
- **Font weight in the bundle.** The Zen Kaku TTFs carry full Japanese glyph
  coverage (≈2.3 MB each) so rank terms (級/段) render in brand voice; both
  weights bundle into each app. `font-display: swap` keeps first paint on
  `system-ui`. A future optimization is a subset/`woff2` build behind the same
  `@font-face`; deferred, as the design ships these files intentionally.
- **Self-host footprint is unchanged** — the package is build-time only; the
  runtime is still app + Mongo + Redis (invariant 10).
- **Boundaries lint** keeps `@obikai/ui` a dependency-free leaf; it can never
  reach the api-client, db, or adapters.
