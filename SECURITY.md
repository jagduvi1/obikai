# Security Policy

Obikai handles personal data and payments. We take security seriously and follow
least-privilege, defense-in-depth, and privacy-by-design.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately to **security@accure.se** (placeholder — update before launch). Include steps
to reproduce, affected component, and impact. We aim to acknowledge within 72 hours and to
agree a coordinated disclosure timeline.

If you have a fix, a private patch is welcome; please do not push it to a public branch before
disclosure is coordinated.

## Scope

In scope: the application code in this repository (api, worker, web, packages, adapters),
default Docker images, and default configuration. Out of scope: third-party services you
configure (your SMTP server, S3 provider, PSP), and self-host deployments you have modified.

## Hardening baseline (already in the foundation)

- Secrets via env only; none in the repo. Webhook-driven payment state, never trusted from the
  client; signature verification + idempotency keys.
- Multi-tenant isolation enforced structurally (tenant context + query guard), not by
  convention. See [docs/decisions/0004-tenancy-auth-rbac.md](docs/decisions/0004-tenancy-auth-rbac.md).
- Argon2id password hashing; short-lived access tokens + rotating refresh with reuse detection.
- Dependency + license + vulnerability scanning in CI; non-root, minimal container images.
- GDPR primitives (consent, audit log, export, erasure) as first-class building blocks.
