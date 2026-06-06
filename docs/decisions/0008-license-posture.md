# 0008 — AGPL license posture & CI gate

**Status:** Accepted · 2026-06-06

## Context

Invariant 1: Obikai is AGPL-3.0-or-later; every dependency must be AGPL-compatible (permissive —
MIT/ISC/BSD/Apache-2.0 — is fine; no AGPL-incompatible or proprietary code bundled), enforced by
a CI license check. Two subtleties an honest posture must address: a key dev/test dependency is
MPL-2.0, and the mandated datastore (MongoDB) is SSPL.

## Decision

**Deny-by-default CI gate** (`pnpm license:check`, `scripts/license-check.mjs`) over the whole
workspace against an explicit SPDX allowlist:

```
MIT, MIT-0, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, Zlib, CC0-1.0, Unlicense,
BlueOak-1.0.0, MPL-2.0, AGPL-3.0-or-later (our own packages)
```

The gate also resolves compound SPDX expressions: an `OR` passes if any operand is allowed; an
`AND` passes only if every operand is allowed.

`MIT-0` (MIT No Attribution — e.g. `nodemailer`) is strictly more permissive than MIT (it
drops even the attribution requirement) and is AGPL-compatible, so it is on the allowlist.

A dependency with any other or unknown license **fails the build** (fails closed). The
secondary record is a CycloneDX SBOM produced at release.

**Documented exceptions / posture (so invariant 1 is *verified*, not assumed):**

- **MPL-2.0** (`axe-core` / `@axe-core/playwright`) is on the allowlist. It is weak/file-level
  copyleft, FSF-listed AGPL-compatible, and used **dev/test-only — never bundled into a shipped
  artifact**, so it raises no distribution concern.
- **Zlib** is on the allowlist: a permissive, FSF-certified GPL/AGPL-compatible license. It arrives
  transitively via `pako` (SPDX `MIT AND Zlib`) under `pdf-lib`, used to render compliant invoice
  PDFs (ADR-0013/0018). Both operands of the `AND` are permissive, so the compound is acceptable.
- **MongoDB Server is SSPL-1.0** and **MinIO is AGPL-3.0**. Both are consumed as **unmodified
  external services** (the operator's own, or our compose pulls the upstream image) — never
  bundled, modified, or source-linked into Obikai's code — so they do not affect our license
  obligations. Note: `mongodb-memory-server` (MIT) downloads SSPL **binaries** via a postinstall
  script that the npm-metadata license checker cannot see; this is intentionally out of the
  gate's scope and accepted as a test-only external service.

**Boundary of "TypeScript end-to-end" (invariant 8):** all *application and business logic* is
TypeScript. Edge proxy (Traefik), the static web server, and CI tooling are conventional infra
and exempt — but the one security-relevant config they consume, the **CSP/security headers, is
generated from a TypeScript source-of-truth and tested**, never hand-authored.

## Consequences

- Every direct dependency chosen for Phase 0 is verified MIT/ISC/BSD/Apache-2.0 (+ axe-core
  MPL-2.0, dev-only). No GPL/AGPL/proprietary runtime code is bundled.
- An in-app "source available" footer link will satisfy the AGPL §13 source offer (app layer).

## Alternatives considered

A denylist (fails open on unknown licenses); FOSSA/Snyk (SaaS, account-gated — against the
offline/no-lock-in ethos, kept only as an optional extra). Both rejected as the authoritative
gate.
