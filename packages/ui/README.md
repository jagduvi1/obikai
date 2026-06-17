# @obikai/ui

The Obikai design system as code: **token CSS**, the **Zen Kaku Gothic New**
display font (OFL), the **brand mark**, and the React **component primitives** —
the shared visual language for the `web-admin`, `web-member`, and `web-platform`
apps.

> The product is a quiet, dark, high-trust admin instrument. Dark-only, borders
> define cards (not shadows), no gradients (except the functional belt bands),
> system-ui body / Zen Kaku display, sentence case, no emoji.
> **"Belt is a presentation type, not an assumption."**

## Usage

Link the stylesheet once per app (it `@import`s every token + the font), then
author against the CSS custom properties — never hard-code hex:

```ts
import '@obikai/ui/styles.css';
```

```tsx
import { BeltChip, Badge, Button } from '@obikai/ui';

<BeltChip label="Blue belt" belt="blue" stripes={2} />
<Badge tone="ready">Ready</Badge>
<Button variant="primary">Award next rank</Button>
```

The package is consumed **as source** by the Vite apps (no build step). It
depends only on `react` (peer).

## Contents

- `styles.css` — single entry point; `@import`s `tokens/*.css`.
- `tokens/` — `colors.css`, `typography.css`, `spacing.css`, `base.css`,
  `fonts.css` (the `@font-face` for the display face).
- `assets/` — `obikai-mark.svg` (also inlined as `<BrandMark>`), `fonts/`
  (the OFL Zen Kaku Gothic New TTFs + license).
- `src/` — the components:
  - forms: **Button**, **TextField**, **Select**
  - display: **Badge**, **StatCard**, **Avatar**, **BrandMark** / **BrandLockup**
  - rank: **BeltChip**, **CriteriaMeter**, **CriterionTag**
  - scheduling: **ClassCard**
  - billing: **InvoiceDocument** (dark + `variant="paper"` print artifact)

## Font license

The display face **Zen Kaku Gothic New** (Yoshimichi Ohira) ships under the
SIL Open Font License 1.1 — see `assets/fonts/OFL-ZenKakuGothicNew.txt`. OFL is
compatible with the project's AGPLv3 license.

Derived from the Obikai monorepo design language (each app's former
`src/styles.css`), promoted here so the three frontends share one source of
truth. See `docs/decisions/` for the ADR introducing this package.
