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
- Architecture decision records in `docs/decisions/`.
