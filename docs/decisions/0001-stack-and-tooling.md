# 0001 — Stack & tooling

**Status:** Accepted · 2026-06-06

## Context

Obikai is a large, long-lived, contributor-facing, AGPL, EU-first, TypeScript-end-to-end
codebase that must run identically as hosted multi-tenant SaaS and single-tenant self-host,
with a small self-host footprint (app + MongoDB + Redis). `docs/scope.md` §8/§10 suggests a
MERN-on-TypeScript baseline and long-lists NestJS, Mongoose, BullMQ. The Glosan reference app
validated the runtime stack (Express/Mongoose/Mongo/React/Vite/Traefik/Docker) but is plain
JS, single-tenant, with hardcoded vendors — we improve on it, we do not copy its layout.

## Decision

| Concern | Choice | Note |
|---|---|---|
| Language | **TypeScript** (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | Invariant 8 |
| Monorepo | **pnpm workspaces + Turborepo** + TS project references | strict deps protect boundaries |
| Backend | **NestJS** (api + worker) on the Express adapter | DI is the adapter seam |
| Data | **Mongoose 8** behind a repository layer | index/transaction control; ODM hidden |
| Validation | **Zod** at every trust boundary | types inferred from schemas |
| Lint/format | **Biome** + minimal **ESLint** (import-boundaries only) | speed + boundary enforcement |
| Tests | **Vitest + fast-check + Supertest**; Playwright + axe for e2e | property tests for engine/billing |
| Jobs | **BullMQ + ioredis** | Redis already in footprint |
| Auth libs | **argon2** + **jose** + **openid-client** | self-hostable; OIDC optional |
| Dates/money (engine) | **@js-temporal/polyfill** + **decimal.js** | deterministic, zone-explicit |
| Releases | **Changesets** + Conventional Commits | independent lib semver, CHANGELOG |

## Consequences

- Pure, dependency-light packages (`domain`, `config`, `adapter-contracts`, `rank-engine`,
  `gdpr`, `i18n`) install and typecheck without native builds, so they are cheap to verify.
- NestJS DI binds an adapter port to a concrete implementation chosen by config at boot —
  hosted vs self-host differ only in which provider modules register.
- All chosen libraries are MIT/ISC/BSD/Apache-2.0 (see ADR-0008).

## Alternatives considered

Express + hand-rolled structure (Glosan's; reinvents conventions, risky for multi-tenant PII);
Prisma-Mongo (engine-binary bloat, lagging Mongo features); Jest (heavier ESM/TS in a
monorepo); Nx (heavier than needed); npm/yarn-berry workspaces (weaker isolation / tooling
friction). All rejected for the reasons in the table.
