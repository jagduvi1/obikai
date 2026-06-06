# 0009 — Config & secrets via validated env

**Status:** Accepted · 2026-06-06

## Context

One codebase serves two deploy modes; self-hosters configure everything themselves; no secrets
may live in the repo; optional integrations toggle via feature flags (`docs/scope.md` §3,
invariants 2, 3, 10). The Glosan reference read `process.env` ad hoc and untyped.

## Decision

- **All configuration is environment-driven**, parsed and **validated once at boot by
  `@obikai/config` with Zod**; the app refuses to start on an invalid/missing value (fail-fast,
  readable errors). `.env.example` is the documented, tracked template; `.env` is git-ignored.
- **Defaults are the self-hostable, no-lock-in, AI-off choices** (ADR-0003/0006): `STORAGE=s3`
  (MinIO endpoint) with an `fs` fallback, `EMAIL=smtp`, `SMS=disabled`, `AUTH=local`,
  `PAYMENT=manual`, `AI=none`, `RUN_WORKER_IN_PROCESS=true`. A fresh self-host boots needing only
  app + Mongo + Redis + the operator's own S3 + SMTP endpoints.
- **Secrets are values or references, never committed.** Per-tenant provider secrets (hosted
  plane) are stored as `SecretRef`s (env / vault path) or envelope-encrypted, never as plaintext
  in a tenant document.
- **Adapter selection is config:** `@obikai/config` resolves each port to a concrete
  `adapters/*` implementation; NestJS DI binds the token at boot. Hosted vs self-host differ
  only in which providers register and in the `ConfigResolver` source (env block vs
  tenant-override-over-platform-default).
- **A public `capabilities` endpoint** reflects the resolved providers + capabilities so the
  SPAs hide controls a deployment can't do (no dead Stripe/SMS/AI buttons in a cash, AI-off
  self-host).
- **Email-independent first-run owner bootstrap** (`obikai create-owner` CLI / `BOOTSTRAP_*`
  env) so a first-boot SMTP misconfiguration cannot lock out the only admin; `/readyz` includes
  an email-transport probe.

## Consequences

- The minimum viable self-host footprint is stated honestly: **app + Mongo + Redis + an
  S3-compatible endpoint + an SMTP endpoint** (the last two operator-owned, or the bundled
  MinIO/Mailpit). It is not Mongo+Redis alone.
- Telemetry is opt-in (`TELEMETRY_ENABLED=false` default).

## Alternatives considered

Ad-hoc `process.env` reads (Glosan's — untyped, no fail-fast); storing provider secrets in the
tenant DB (security/GDPR risk); separate config codepaths per deploy mode (violates invariant 2).
All rejected.
