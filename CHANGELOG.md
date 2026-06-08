# Changelog

All notable changes to Obikai are documented here. This project adheres to
[Semantic Versioning](https://semver.org) and uses
[Conventional Commits](https://www.conventionalcommits.org). Library packages are versioned
independently via [Changesets](https://github.com/changesets/changesets).

## [Unreleased]

### Added — Phase 0 (Foundations)

- **Account-recovery screens** in the admin SPA — closing the loop on the E1/E2/E3 backend so the
  emailed links work end-to-end. Public routes `/forgot-password`, `/reset-password?token=…`,
  `/verify-email?token=…` plus a change-password card in Settings; a "Forgot your password?" link on
  sign-in. Accessible (labelled inputs, `output`/`alert` live regions), i18n (en + sv), client-side
  password-match/length checks, and no-enumeration messaging on the forgot flow. New
  `@obikai/api-client` methods (`requestPasswordReset`, `confirmPasswordReset`,
  `requestEmailVerification`, `confirmEmailVerification`, `changePassword`).
- **Email verification** (account lifecycle E2). A verification email (single-use, 24h token) is sent
  on registration and on demand via `POST /auth/verify-email/request` (always 204 — no enumeration);
  `POST /auth/verify-email/confirm` consumes the token and flips `emailVerified` on both the User and
  the local Identity. New tenant-global `EmailVerificationToken` collection (sha256-hashed, TTL-reaped,
  purged on erasure), `markEmailVerified` repo methods, and `NotificationsService.sendEmailVerification`
  + `email.verify.*` en/sv copy. `AuthService` deps were refactored to a named object as the
  constructor grew across reset/change/verification.
- **Password change** (account lifecycle E3). `POST /auth/password` (authenticated via the access
  token — the `/auth` plane is outside the tenancy middleware, so the controller verifies the Bearer
  itself) proves the **current** password before setting a new one (a stolen access token alone can't
  change it; the `userId` comes from the verified token, never the body), then revokes **all** of the
  user's sessions and issues a fresh one for the caller. New `AuthService.changePassword` +
  `passwordChangeSchema` (new password ≥12 chars and must differ from the current).
- **Password reset** (account lifecycle E1). `POST /auth/password-reset/request` always returns 204
  whether or not the email exists (no account-enumeration oracle) and, when it does, emails a
  single-use, time-boxed (1h) reset link via `@obikai/notifications`; `POST /auth/password-reset/confirm`
  consumes the token (atomic, single-use), sets the new password, and **revokes ALL of the user's
  sessions** so any session minted under the old credential dies. New primitives: `AuthPort.setPassword`
  (subject-keyed) on the local adapter, `IdentityRepository.updatePasswordHashByUserId`, a
  tenant-global single-use `PasswordResetToken` collection (sha256-hashed tokens, TTL-reaped), and
  `TokenService.revokeAllSessions`. Reset tokens are purged on GDPR erasure. New config `APP_NAME`
  (account-email branding) + `APP_PUBLIC_URL` (reset deep link; raw token emailed when unset).
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
- The worker's `dunning` job now **sends** the overdue-invoice notice: each invoice advanced along the
  ladder emails the member through the shared `@obikai/notifications` service over the default SMTP
  `EmailPort` (built once at worker boot, disposed on shutdown). Best-effort — a mail failure is logged
  and counted (`noticesFailed`) but never rolls back the advance nor aborts the sweep, and the worker
  runs notice-free when no email provider is configured (audit C1).
- The worker's `reminders` job is now **implemented** (was a stub): an hourly `reminders-tick` platform
  job fans out a per-tenant sweep that emails each booked member of every class starting within the
  24h lead window an upcoming-class reminder (rendered in the schedule's timezone). Each booking is
  **atomically claimed** (`Booking.reminderSentAt`, null → now) before its reminder is sent, so a
  re-delivered job or overlapping tick reminds **at most once** — it spams nobody. The tick is only
  registered when email is configured (no needless churn on a no-email self-host) (audit C2).
- Architecture decision records in `docs/decisions/`.
- GDPR remediation (begun): a per-tenant, append-only, tamper-evident audit log
  (`AuditLogRepository` in `@obikai/db`) built on the `@obikai/gdpr` hash-chain primitives — the
  accountability substrate (Art. 5(2)/30) every personal-data action will record to. First step of
  wiring the previously-orphaned `@obikai/gdpr` package into the runtime (see
  `docs/gdpr-audit-2026-06.md`, ADR-0026).
- GDPR: every member mutation (create / update / delete) is now recorded on the tenant's audit chain
  with the acting user, target, source IP, and (for updates) the changed field NAMES only — closing
  the previously **unaudited hard-delete** of member records (audit H9).
- GDPR: **structural external-AI PII gate** (invariant 4). `withPersonalDataGate(port, {isLocal})`
  wraps any resolved `AiPort` so a request carrying personal data sent to an **external** AI
  sub-processor is refused (`AiPersonalDataRefusedError`) *before* the provider is called — the
  guarantee no longer depends on each caller checking `containsPersonalData`. A local model passes
  through. Closes the documented regression trap (the gate was advertised but unimplemented); ready to
  wrap the port whenever a cloud AI adapter is wired.
- GDPR: **EU data-residency enforcement** (Arts. 44–49). In **hosted** mode the object-storage region
  (`S3_REGION`) must be an EU/EEA region — boot validation fails otherwise — so the managed service can
  never silently place member data outside the EU. An audited `ALLOW_NON_EU_RESIDENCY=true` escape
  hatch allows an override; self-host is exempt (the operator controls physical location). A test
  guards the default region staying EU.
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

- Self-host clarity: the background `worker` service (recurring billing, dunning, reminders) is now
  documented as a **required** service that `docker compose up` starts — not "optional" — and the
  misleading `RUN_WORKER_IN_PROCESS=true` default (which did nothing; in-process hosting isn't
  implemented) is flipped to `false` so operators don't disable the worker thinking the API covers it
  (audit B1).
- Worker job durability: every enqueued job now **retries transient failures** (3 attempts,
  exponential backoff) and old completed/failed jobs are **reaped** (bounded Redis memory) — a single
  Mongo/Redis blip no longer permanently drops a tenant's billing/dunning run, and jobs don't pile up
  on the small self-host footprint (audit B2). Handlers are idempotent, so retries are safe.
- `/readyz` now reflects **real** readiness — it checks the live Mongo connection instead of returning
  a hardcoded all-true, so an orchestrator won't route traffic to an instance with a dead database
  (audit F1). `/healthz` stays dependency-free for liveness. (Redis/migrations/email checks are added
  as those become hard dependencies for the api.)
- API observability: a **global exception filter** (unmapped errors → structured server-side log +
  `x-request-id`, generic 500 body that leaks nothing), **structured JSON logging** matching the worker
  (one shipper parses both), and the auth adapter's logger is **no longer silenced** (failed
  logins/lockouts are now recorded) — audit F2/F3.
- API hardening: **security headers (helmet)** on the JSON API, configurable **CORS** allow-list
  (`CORS_ORIGINS`, credentials-aware), and **graceful shutdown** (drains in-flight requests + closes
  Mongo cleanly on SIGTERM/SIGINT, so deploys are zero-downtime-safe and can't truncate billing/PII
  writes) — audit E5/F4.
- Boot safety: the app now **refuses to start with a placeholder/example secret** for
  `AUTH_JWT_SECRET` or `DATA_MASTER_KEY` (the `.env.example` "change-me…" values fail validation by
  design) — a self-hoster can't accidentally ship a publicly-known signing key (audit E4).
- Deploy: `docker-compose.prod.yml` now references the images **release.yml actually publishes**
  (`${IMAGE_REGISTRY}/${IMAGE_NAMESPACE}/obikai-{api,worker}`, overridable) instead of a name that
  404s (audit G5).
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

- Extracted `NotificationsService` (+ email catalogs) into a shared `@obikai/notifications` package so
  both the api and the worker can send transactional email (the worker can't import from `apps/api`).
  No behavior change — the api wires it exactly as before; this unblocks wiring dunning/reminder emails
  from worker jobs (audit C).
- Occurrence materialization now issues a single `bulkWrite` instead of N sequential upserts —
  collapsing an N-occurrence horizon (e.g. ~90 for a daily class over 90 days) into one round-trip.
  Idempotency is unchanged (same `{tenantId, scheduleId, startsAt}` unique index + `$setOnInsert`).
