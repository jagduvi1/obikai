# 0003 — Monorepo layout & enforced import boundaries

**Status:** Accepted · 2026-06-06

## Context

The product reuses logic across an API, a worker, an admin web app, a member PWA, and (later) a
React Native app — and ships genuinely reusable libraries (the rank engine, the adapter
contracts). It must keep the spine (rank/grading) framework- and DB-agnostic, and keep AI
structurally out of the rank-decision path (invariants 4, 5).

## Decision

A pnpm-workspace monorepo with three top-level groups:

```
apps/      api, worker, web-admin, web-member, mobile (later), docs
packages/  config, domain, adapter-contracts, rank-engine, db, i18n, ui, sdk, gdpr, test-utils
adapters/  email-smtp, storage-{s3,fs}, payments-{manual,stub,…}, auth-{local,oidc}, ai-{none,…}, sms-{disabled,…}
```

Import boundaries are **mechanically enforced** in CI (`eslint-plugin-boundaries`,
[`eslint.config.mjs`](../../eslint.config.mjs)). The directional rules — and the single most
important one:

> **`rank-engine` may import ONLY `domain`.** Never a DB, an adapter, a framework, `node:*`, or
> the AI adapter.

Other key edges: `adapter-contracts → domain`; `adapters/* → adapter-contracts, domain, config`
(never `db`/apps); `db → domain, config`; apps are the composition root and may wire everything.
`adapters/*` are a separate top-level group (not under `packages/`) so a license scan can assert
the **default** dependency set is proprietary-free.

## Consequences

- The engine is pure → trivially unit/property-testable, offline-capable, identical across
  deploy modes, and **incapable of calling AI by construction**. A second, independent check
  (`scripts/assert-rank-engine-purity.mjs`) asserts the built engine's dependency closure
  contains no DB/framework/AI package, so a single ESLint misconfig cannot open the seam.
- Web/mobile can reuse the exact same evaluator client-side for the "ready/close/not-yet"
  preview with no server round-trip.

## Alternatives considered

Single root tsconfig with path aliases (no incremental build graph); rank logic inside Mongoose
models (Glosan's coupling — needs a live DB to test, tempts mid-evaluation fetches); adapters
under `packages/` (muddies the "default set is proprietary-free" assertion). All rejected.
