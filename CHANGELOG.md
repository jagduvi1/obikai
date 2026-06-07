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
- GDPR remediation (begun): a per-tenant, append-only, tamper-evident audit log
  (`AuditLogRepository` in `@obikai/db`) built on the `@obikai/gdpr` hash-chain primitives — the
  accountability substrate (Art. 5(2)/30) every personal-data action will record to. First step of
  wiring the previously-orphaned `@obikai/gdpr` package into the runtime (see
  `docs/gdpr-audit-2026-06.md`, ADR-0026).
- GDPR: every member mutation (create / update / delete) is now recorded on the tenant's audit chain
  with the acting user, target, source IP, and (for updates) the changed field NAMES only — closing
  the previously **unaudited hard-delete** of member records (audit H9).
- GDPR: **PII removed from logs** (data-minimization, Art. 5(1)(c)). A registration race past the soft
  email check hit the unique index and the raw Mongo E11000 (whose message embeds the email) reached
  Nest's default 5xx logger; it is now translated to a typed `EmailAlreadyRegisteredError` → 409 (never
  logged). Also dropped the email from the local-auth "register rejected" warn and from the
  `create-owner` / `grant-platform-admin` CLI logs (they log the userId instead).
- GDPR: **fail-safe tenant-isolation coverage test** (Art. 5(1)(f)/32). A test enumerates every
  registered Mongoose model and asserts each is either tenant-guarded (a query with no TenantContext
  throws) or in an explicit tenant-global allow-list — so a future PII model that forgets
  `plugin(tenantGuard)` fails the build instead of silently leaking across tenants.
- GDPR: **right to erasure** (Art. 17, audit H4/H6). `POST /members/:id/erasure` (staff-only,
  irreversible) runs a tested cross-collection erasure: anonymize the Member root (releasing the
  unique-email index), hard-delete the footprint (bookings/attendance/enrollments/rank state/curriculum/
  membership), delete waiver document blobs from storage + anonymize their columns, scrub retained
  free-text (grading notes, promotion override reasons), and erase the linked account (anonymize email,
  delete credentials + sessions). De-identifying the Member root de-identifies every member-keyed
  reference (they hold only the opaque id). The action is recorded on the tenant audit chain. A test
  asserts no raw PII for the subject survives in any collection.
- GDPR: **data-subject export** (Art. 15/20, audit H7). `GET /me/data-export` returns a machine-readable
  JSON bundle of all the caller's personal data — member-keyed PII assembled via the ROPA registry plus
  the tenant-global identity (login account + sessions; secrets excluded). The access is recorded on
  the tenant audit chain. A member can now download their own data.
- GDPR: **executable ROPA registry** (Art. 30) — `buildRopaRegistry()` registers a `ProcessingRecord`
  (purpose, lawful basis, controller/processor role, retention, `findBySubject`, `toExport`, erasure
  strategy) for every member-keyed PII model (member, attendance, booking, enrollment, invoice,
  payment, rank state, promotion, grading result, curriculum completion, waiver). This is the keystone
  that drives data export (Art. 15/20) and erasure (Art. 17) in the next PRs — accountability as code.
- GDPR: **self-service consent** (Art. 6(1)(a)/7, audit H8). An append-only `ConsentModel` +
  `ConsentRepository` (db, implementing the `@obikai/gdpr` port) where withdrawal appends a `withdrawn`
  record and never erases the grant evidence (Art. 7(1) demonstrability), plus `/me/consent` endpoints
  (`GET` list, `POST` grant, `DELETE /:purpose` withdraw) — a member can now grant and withdraw their
  own consent, each change recorded on the tenant audit chain.

### Fixed

- Invoice issuing is now crash-safe: the gapless number is allocated first and committed together
  with `status: 'open'` + `issuedAt`/`dueAt` in a single atomic write (`claimForIssueWithNumber`),
  so a crash can never leave a persisted "open invoice without a number" (a legally-invalid issued
  invoice). The draft is confirmed before allocating, so re-issuing a non-draft never burns a number.
  Residual on single-node Mongo: a crash between the counter increment and the claim leaves an
  unused number (an auditable gap, not a malformed invoice); full two-document atomicity needs a
  replica-set transaction (tracked separately).
- Waitlist promotion on booking cancel is now race-safe: each waitlisted candidate is promoted with
  an atomic compare-and-swap (`promoteIfWaitlisted`) and the cancel advances past any candidate a
  concurrent cancel already claimed — so two concurrent cancels can no longer both promote the same
  booking and silently lose a freed seat.
- A same-member double-book that races past the soft pre-check now returns **409 Conflict** (typed
  `DuplicateBookingError` from the `{occurrence, member}` unique index) instead of a raw 500.
- Scheduling endpoints now map state conflicts to **409 Conflict** (was 400), matching the auth and
  billing modules.

### Changed

- Occurrence materialization now issues a single `bulkWrite` instead of N sequential upserts —
  collapsing an N-occurrence horizon (e.g. ~90 for a daily class over 90 days) into one round-trip.
  Idempotency is unchanged (same `{tenantId, scheduleId, startsAt}` unique index + `$setOnInsert`).
