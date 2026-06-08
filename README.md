# Obikai

[![CI](https://github.com/jagduvi1/obikai/actions/workflows/ci.yml/badge.svg)](https://github.com/jagduvi1/obikai/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jagduvi1/obikai/actions/workflows/codeql.yml/badge.svg)](https://github.com/jagduvi1/obikai/actions/workflows/codeql.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](tsconfig.base.json)

**Dojo-native, open-source SaaS for martial-arts schools.** Built around the martial-arts
journey — a configurable rank/grading engine, curriculum, attendance-linked promotions,
competition, and dojo community. Membership, billing, and scheduling are the administrative
backbone, not the point.

One AGPLv3 codebase runs as a **multi-tenant hosted service** *and* can be **self-hosted by a
single dojo** (or an association hosting several clubs). Nordics / EU first.

> **Status:** Phase 0 (foundations) ✅ and most of Phase 1 (dojo core — members/households, auth,
> billing + EU VAT, scheduling, attendance, waivers) are built and tested. The backend runs with
> one `docker compose up`. See the **[Roadmap](ROADMAP.md)** for what's done and what's next.

This is **not** a gym/fitness app. No workout logging, body-composition tracking, or
fitness-class framing.

## Why Obikai

- **Martial-arts-native rank engine** — declarative config + a deterministic, testable
  evaluator. "Belt" is a presentation type, not an assumption: it handles belts + stripes,
  kyu/dan, levels/tiers, and belt-less arts. Rank systems are versioned; promotion history is
  immutable. ([docs/scope.md](docs/scope.md) §12)
- **No vendor lock-in** — payments, email, SMS, storage, auth, and AI all sit behind provider
  interfaces with self-hostable defaults (SMTP, S3/MinIO, local auth, AI off).
- **EU-first compliance built in** — GDPR primitives, i18n (sv/nb/da/fi/en), EU VAT,
  WCAG 2.1 AA, EU data residency.
- **AI is optional and never authoritative** — the product is fully functional with AI
  disabled; AI helps *author* config/content, never decides ranks.

## Architecture at a glance

A TypeScript monorepo (pnpm + Turborepo). See [docs/decisions/](docs/decisions/) for the ADRs.

```
apps/        api (NestJS), worker (BullMQ), web-admin, web-member (PWA), mobile (later)
packages/    domain, config, adapter-contracts, rank-engine (pure), db, i18n, ui, sdk, gdpr, test-utils
adapters/    email-smtp, storage-{s3,fs}, payments-{manual,stub,stripe,…}, auth-{local,oidc}, ai-{none,ollama,…}, sms-{disabled,…}
```

**The crown jewel:** [`packages/rank-engine`](packages/rank-engine) is a pure, deterministic,
framework- and DB-agnostic library that may import **only** `packages/domain`. That boundary
(CI-enforced) is what keeps the engine testable, offline-capable, identical across deploy
modes, and structurally incapable of calling AI.

## Quick start (local dev)

Requires Node ≥ 20, pnpm ≥ 9, Docker.

```bash
cp .env.example .env            # defaults are self-hostable + AI-off
pnpm install
docker compose --profile local up   # app + Mongo + Redis + MinIO + Mailpit, one command
```

Run the pure-package checks (no Docker needed):

```bash
pnpm typecheck
pnpm --filter @obikai/rank-engine test
pnpm license:check              # AGPL-compatibility gate (also runs in CI)
```

## Self-hosting

A single dojo needs: **app + MongoDB + Redis + an S3-compatible endpoint + an SMTP endpoint**
(the last two are your own, or the bundled MinIO/Mailpit). See the **[self-hosting guide](docs/self-host.md)**
and [docker/](docker/). One `docker compose up`; configuration is all env vars
([.env.example](.env.example)); datastore auth is on by default; telemetry is opt-in.

## License

[AGPL-3.0-or-later](LICENSE). Running a modified version as a network service obligates you to
offer users the corresponding source (AGPL §13). Every dependency is kept AGPL-compatible,
enforced by a CI license check. The Obikai name and logo are **not** covered by the code
license.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Note: the **contribution agreement (CLA vs DCO/no-CLA)
is not yet decided** — external PRs cannot be merged until it is.
