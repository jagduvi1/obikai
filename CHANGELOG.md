# Changelog

All notable changes to Obikai are documented here. This project adheres to
[Semantic Versioning](https://semver.org) and uses
[Conventional Commits](https://www.conventionalcommits.org). Library packages are versioned
independently via [Changesets](https://github.com/changesets/changesets).

## [Unreleased]

### Added — Phase 0 (Foundations)

- TypeScript monorepo (pnpm workspaces + Turborepo) with enforced import boundaries.
- Pluggable adapter contracts (payments, email, SMS, storage, auth, AI) with self-hostable
  default implementations (SMTP, S3/MinIO + local filesystem, manual/stub payments, local
  argon2id auth, AI off, SMS disabled).
- Pure, deterministic `@obikai/rank-engine` (declarative config + evaluator) with versioned,
  immutable promotion history and structural AI exclusion. Property-tested with fast-check.
- Multi-tenant isolation seam (request-scoped tenant context + hardened query guard) and
  self-hostable auth + RBAC scaffolding.
- i18n scaffolding (sv/nb/da/fi/en, ICU, content-vs-UI split) and GDPR primitives (consent,
  hash-chained audit log, export, erasure with per-model policy, ROPA/retention registry).
- Docker + docker-compose (one-command local/self-host), Traefik edge, CI/CD with an AGPL
  license gate, SBOM, and image signing.
- Tenant-global tenant registry (`Tenant` domain type + `TenantRegistryRepository`,
  platform-marker-guarded enumeration) and a worker recurring-billing scheduler: a daily
  `billing-tick` platform job fans out per-tenant `billing-run` + `dunning` under `runAsPlatform`.
  Self-host registers its tenant at bootstrap (ADR-0017).
- Architecture decision records in `docs/decisions/`.

### Fixed

- Invoice issuing is now crash-safe: the gapless number is allocated first and committed together
  with `status: 'open'` + `issuedAt`/`dueAt` in a single atomic write (`claimForIssueWithNumber`),
  so a crash can never leave a persisted "open invoice without a number" (a legally-invalid issued
  invoice). The draft is confirmed before allocating, so re-issuing a non-draft never burns a number.
  Residual on single-node Mongo: a crash between the counter increment and the claim leaves an
  unused number (an auditable gap, not a malformed invoice); full two-document atomicity needs a
  replica-set transaction (tracked separately).
