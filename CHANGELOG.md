# Changelog

All notable changes to Obikai are documented here. This project adheres to
[Semantic Versioning](https://semver.org) and uses
[Conventional Commits](https://www.conventionalcommits.org). Library packages are versioned
independently via [Changesets](https://github.com/changesets/changesets).

## [Unreleased]

### Added — Phase 0 (Foundations)

- **Upgrade NestJS 10 → 11 + Express 4 → 5 (`@obikai/api`).** Bumped `@nestjs/core`, `@nestjs/common`,
  `@nestjs/platform-express`, `@nestjs/testing` to `^11.1` and `@types/express` to `^5` (the runtime is
  now Express `5.2` / `path-to-regexp` `8`). Despite the path-to-regexp 8 rewrite, **our existing route
  patterns work unchanged** — NestJS 11 normalises them internally, so `@Get('*')`/`@Put('*')` (fs files
  controller), `forRoutes('*')` + `exclude('auth/(.*)', …)` (tenancy middleware) and `forRoutes('platform/*')`
  (platform middleware) all still register and match. This is proven empirically: the real-app integration
  boot registers every one of them and a new assertion drives a nested `/files/*` request to a 403 (route
  matched) rather than a 404 (no route). The one genuine break was **NestJS 11's stricter injector** — it
  now throws on an unresolved constructor param instead of silently injecting `undefined`. The former
  `src/platform/platform.wiring.test.ts` exploited that old leniency (it booted `PlatformModule` under
  esbuild, whose stripped `design:paramtypes` left injected deps `undefined`, which was fine for its
  no-auth 401 path). Under Nest 11 that throws, so the wiring assertions were relocated to a real-app
  integration test (`test/platform-wiring.int.test.ts`, SWC metadata + full DI) and the esbuild-bound unit
  test was deleted. No production code changed. Full suite green (api 180 unit + 14 int). (Closes
  Dependabot's held `@nestjs/core` and `@nestjs/platform-express` bumps and the `@types/express` 5 bump;
  `@nestjs/common`/`@nestjs/testing` had no Dependabot PRs and were lifted to match.)
- **Upgrade mongoose 8 → 9 (`@obikai/db`).** mongoose 9 (which bundles the MongoDB driver 6 → 7)
  tightened types and removed callback-style middleware — both of which our tenant-isolation layer
  leans on heavily. Changes: `FilterQuery<T>` → `QueryFilter<T>`; the four `tenantGuard` pre-hooks
  (`pre(SCOPED_QUERY_OPS)`, `pre('validate')`, `pre('insertMany')`, `pre('aggregate')`) are now
  **synchronous** — mongoose 9 dropped the `next` callback, and `insertMany`'s pre-hook receives the
  docs array as its first positional arg (the runtime `TypeError: next is not a function` this fixed
  was the only behavioural break); `create()`'s stricter `DeepPartial/Require_id` typing is satisfied
  with a single cast at the `TenantRepository.create` boundary (our `T` is a plain `TenantScoped`
  shape with branded/readonly fields); query filters keep their literal-union types (dropped the
  defensive `String(status)` coercions that mongoose 9 now rejects); and every deprecated
  `{ new: true }` option migrated to `{ returnDocument: 'after' }`. No schema or data migration — the
  wire format is unchanged. Full suite green (db 146, api 184+9, worker 26). (Closes Dependabot's held
  mongoose bump.)
- **Upgrade zod 3 → 4 (catalog-wide).** zod is a `catalog:` dependency used across 9 packages / ~65
  files, but the v4 break for our code was tiny: only `z.SafeParseReturnType` (removed) and
  `z.SafeParseError` (→ `ZodSafeParseError`) in `tryLoadConfig` (`@obikai/config`). Fixed by typing the
  result as `{ success: true; data } | z.ZodSafeParseError<unknown>`. Everything else — `z.object`,
  `instanceof z.ZodError` + `.issues` handling in ~20 controllers, and the deprecated-but-functional
  string formats (`.email()`/`.url()`/`.datetime()`) — works unchanged; full suite green and zod stays
  MIT. (Migrating the deprecated formats to `z.email()`/`z.iso.datetime()` is a noted, behaviour-
  sensitive follow-up; they emit no runtime warnings. Closes Dependabot's held zod bump.)
- **Translatable rank/curriculum content (i18n H4, ADR-0029).** Dojo-authored display content is now
  `LocalizedString`: `Discipline.name`/`description` and `CurriculumItem.label`/`description`. These are
  app-layer entities, fully decoupled from the immutable rank `versionId` (the engine's versioned config
  is pure structure — no human strings), so **no engine/versioning change and no `versionId` migration**.
  The API returns the raw `LocalizedString`; the SPAs resolve it to the viewer's locale via
  `resolveLocalized` (admin disciplines/classes/member-detail, member progress). The admin disciplines
  form authors a **name per locale**. No data migration ships — Obikai is pre-launch with no legacy
  string-shaped content, and all write paths produce `LocalizedString` directly. Untranslated content
  falls back gracefully (requested → tenant default → en).
- **Upgrade `@noble/hashes` 1 → 2 (rank-engine + gdpr), byte-identically.** v2 reorganised its API:
  `sha256` moved to `@noble/hashes/sha2.js` (subpaths now require the `.js` extension) and no longer
  accepts a string (the implicit UTF-8 encode was removed — we now `utf8ToBytes(...)` explicitly, which
  is the same encoding). Because these primitives produce the rank-system `versionId` (ADR-0005) and the
  GDPR audit hash-chain, the digest **must not change**: new byte-stability tests pin the exact sha256
  hex for fixed inputs (captured under v1) so the upgrade is proven byte-compatible — existing version
  ids and audit chains still verify. (Closes Dependabot's held `@noble/hashes` bump.)
- **GDPR data export now includes consent records (Art. 15).** The data-subject export already covered
  member-keyed PII (via the ROPA registry) plus the tenant-global login account + sessions; it now also
  includes the subject's full **consent history + Art. 7 evidence** (keyed by the account `userId`,
  tenant-scoped). This makes the data-subject rights symmetric — consent is now both **exported** (Art. 15)
  and **erased** (Art. 17). (Household name and crypto-shred remain tracked follow-ups.)
- **GDPR right-to-erasure now also erases consent records (Art. 17).** A data subject's consent records
  carry Art. 7 evidence PII (purpose + `ip`/`userAgent`/`note`) and were previously left intact by member
  erasure. `eraseMemberSubject` now hard-deletes them (keyed by the account `userId`, tenant-scoped so it
  never crosses tenants per ADR-0007). The erasure test seeds a consent record and asserts no consent —
  and no consent-evidence PII — survives. (Consent *export* under Art. 15 and the tenant-global identity
  export remain a tracked follow-up.)
- **Swedish UI: admin complete (i18n H1, part 2).** The admin console is now fully Swedish — every
  namespace (members, disciplines, classes/programs/schedules, schedule/occurrences, locations, plans,
  waivers, billing settings, member invoices, and rank/grading). With member + platform (part 1), all
  three SPAs are **100% Swedish**, each enforced by a completeness test that fails CI on any untranslated
  key. nb/da/fi remain English-fallback stubs pending a native-speaker pass.
- **Swedish UI: member + platform complete (i18n H1, part 1).** The member PWA and the platform console
  are now fully translated to Swedish (every UI key — progress, invoices, tenants, tenant, audit, status,
  nav, auth). A per-app **completeness test** asserts the `sv` bundle covers every English key, so a
  missing translation fails CI rather than silently falling back to English. Nordic siblings (nb/da/fi)
  and the larger admin catalog follow; nb/da/fi remain English-fallback stubs pending a native pass.
- **In-app language switcher + locale activation (i18n H2/H3).** All three SPAs (member, admin, platform)
  now ship a header **language switcher** listing the five UI locales by their endonym (English, Svenska,
  Norsk bokmål, Dansk, Suomi). The chosen language is **persisted** (localStorage) and the app now boots
  in the **detected** locale — a saved preference, else the browser's best match (`sv-SE` → `sv`), else
  English — instead of always English. The active locale is reflected on **`<html lang>`** for assistive
  tech and correct hyphenation (WCAG 3.1.1). The canonical UI-locale set + native names + a pure matcher
  now live once in **`@obikai/i18n`** (`UI_LOCALES`, `UI_LOCALE_NATIVE_NAMES`, `matchUiLocale`), so the
  apps no longer each redeclare them. Activates the translations already present (English complete, sv
  well-covered); filling out nb/da/fi copy (H1) and translatable rank/curriculum content (H4) follow.
- **Deny-by-default npm install scripts (supply-chain hardening, ADR-0028).** A dependency's
  `pre`/`install`/`post`install script runs automatically during `pnpm install` with full developer
  privileges — the vector behind the active 2026 typosquat campaign that planted credential stealers (and
  `.claude/settings.json` agent-hook persistence) via npm. We now pin a **minimal allowlist** in the root
  `package.json` (`pnpm.onlyBuiltDependencies`: `@biomejs/biome`, `@swc/core`, `esbuild`, `unrs-resolver`
  — the only four deps whose native build step our toolchain needs); pnpm blocks lifecycle scripts for
  **every other** dependency. Verified on a clean reinstall: `@nestjs/core`, `mongodb-memory-server`, and
  `msgpackr-extract` scripts are skipped with the full suite still green (`mongodb-memory-server` still
  downloads its binary lazily; BullMQ/`msgpackr` use the JS fallback). Mirrors the ADR-0008 license
  deny-by-default posture.
- **Worker integration tests (I3 — BullMQ over real Redis).** Drives the actual producer → Redis →
  `Worker` → `handleJob` dispatch loop (`apps/worker/test/worker-jobs.int.test.ts`), not the
  framework-free unit fakes: a tenant-scoped job runs to completion, a not-yet-implemented GDPR job
  **fails loudly** (audit H2 — never false success), a job missing its `tenantId` is rejected at the
  worker boundary (ADR-0004), and the platform `billing-tick` fans out per-tenant `billing-run` +
  `dunning` under `runAsPlatform`. `apps/worker/src/main.ts` now exports `handleJob`/`JobDeps` and guards
  `main()` behind an `isMainModule()` check (mirrors the api CLIs) so importing it for tests doesn't boot
  the worker. Redis doesn't run natively on Windows, so the suite **skips** when none is reachable but
  **fails in CI** (where the workflow provides one) so coverage can't silently disappear; Mongo uses an
  ephemeral in-memory server. New worker devDep: `mongodb-memory-server` (MIT, dev-only).
- **API integration tests (I1 HTTP/controller + I2 two-tenant isolation).** First tests that boot the
  **real NestJS app** (full DI graph) over an ephemeral in-memory MongoDB and drive it over HTTP with
  supertest — covering the controller → service → repository → Mongo wiring the unit (service-with-fakes)
  tests can't reach. **I1** (`apps/api/test/http-smoke.int.test.ts`): liveness, the real `/auth/login`
  flow (success + bad-credentials 401), and a member create→list round-trip. **I2**
  (`apps/api/test/tenant-isolation.int.test.ts`): proves the structural multi-tenancy invariant (ADR-0004)
  end-to-end — tenant resolved from the `Host` header (never the token), data scoped per tenant with no
  cross-boundary leakage, the **same** access token granting authority in its own tenant and a 403 in
  another, cross-tenant id reads 404, apex host 404, anonymous 403. Because Nest constructor DI needs
  `design:paramtypes` metadata that vitest's esbuild transform strips, the integration suite runs under
  its **own vitest config** (`vitest.int.config.ts`) using `unplugin-swc` (decorator metadata), while the
  unit suite keeps the esbuild transform unchanged (`vitest.config.ts` excludes `*.int.test.ts`). New api
  devDeps: `unplugin-swc`, `@swc/core`, `mongodb-memory-server` (MIT/Apache-2.0, dev-only). Run with
  `pnpm --filter @obikai/api test` (unit + integration) or `test:int`.
- **Member waiver-signing (member portal).** Members can now read and sign waivers digitally from the
  member app (`/waivers`) — completing the waivers loop (admin authoring already shipped). A new
  self-accessible endpoint `GET /waivers/status?memberId=` returns each **active** template plus whether
  the member has signed its **current version**, computed server-side (`WaiversService.listForMember`) so
  a member never needs the staff `waiver:list` grant and never sees inactive/old templates. Signing is a
  **digital acknowledgement** (typed full name + explicit "I have read and agree" → immutable, dated
  signature via the existing `POST /waivers/sign` self-access path; no document upload). A waiver revised
  to a new version re-prompts the member to re-sign. Guardian-for-minor portal signing remains future
  work; staff can still record those via the API. New `MemberWaiverStatus` read-model in `@obikai/domain`;
  sv translations seeded for the new strings.
- **Database migration runner** (audit G1). A `migrate-mongo`-backed CLI (`apps/api/src/cli/migrate.ts`)
  that ships in the api image and applies forward-only migrations from `@obikai/db`'s `migrations/` dir,
  resolved at runtime so it works in dev and the deployed image. Run with
  `docker compose exec api node dist/cli/migrate.js`; idempotent (a `changelog` collection tracks applied
  files, a `changelog_lock` stops concurrent runners). Verified end-to-end with Docker — apply +
  idempotency + changelog against an authenticated mongo, *and* path resolution inside the built api
  image. License gate stays green with the new dep.
- **Mongo backups for self-host** (audit G3). An opt-in `backup` compose profile dumps the whole
  database (gzipped, timestamped) to a `mongo-backups` volume, authenticating with `MONGO_URI`:
  `docker compose --profile backup run --rm backup`. `docs/self-host.md` documents scheduling,
  copying archives off-box, and the `mongorestore --drop` restore. The dump/restore roundtrip and the
  exact compose entrypoint were verified end-to-end against an authenticated MongoDB.
- **Publish the SPA images on release** (self-host, audit G4). The release workflow built only the
  api/worker images, so a self-host could pull the backend but **no UI** — the three front-ends
  (`obikai-web-admin`, `obikai-web-member`, `obikai-web-platform`, static Caddy-served) were validated
  in CI but never published. The publish matrix now mirrors the CI build matrix (multi-arch, signed,
  SBOM-attested for all five). `docs/self-host.md` documents serving them behind your edge.
- **Datastore authentication for self-host** (security hardening, audit G2). The compose `mongo` service
  now starts with `--auth` (root credentials from `MONGO_ROOT_USER`/`MONGO_ROOT_PASSWORD`) and `redis`
  with `--requirepass` (`REDIS_PASSWORD`) — so a default self-host is no longer reachable
  unauthenticated. `.env.example` ships the credential vars and `MONGO_URI`/`REDIS_URL` that embed them
  (`authSource=admin`); the redis healthcheck authenticates. A **hosted** deployment additionally fails
  to boot if `MONGO_URI`/`REDIS_URL` carry no credentials. New `docs/self-host.md` (setup, secrets, the
  existing-volume auth-migration note, owner bootstrap) — and the README now links it.
- **Waivers admin UI** — the waiver-templates backend (versioned templates, signatures) had no UI. A
  Waivers page (+ nav item) lists templates with their version/status, creates a new one (title +
  markdown body + "guardian must sign for minors"), and activates/deactivates a template. Editing the
  text mints a new version server-side; existing signatures stay pinned. New `@obikai/api-client`-backed
  waivers binding; i18n. The member-facing signing flow is the follow-up.
- **Member invite/onboarding UI** — completes onboarding end-to-end. An "Invite to portal" button on
  the admin member detail page (shown when the member has an email and no account; "Has a portal
  account" once linked) and a public `/accept-invite?token=…` page in the member portal where the
  invited person chooses a password and is auto-signed-in. New `@obikai/api-client` `acceptInvite` +
  admin `inviteMember`; i18n (en + sv); accessible. A member can now be invited and self-onboard.
- **Member invite/onboarding backend** — staff can invite a member to set up a portal login.
  `POST /members/:id/invite` (staff, `member:update`) mints a single-use 7-day token for a member that
  has an email and no account, and emails the accept link; **public** `POST /invites/accept` (excluded
  from the tenancy middleware — the tenant is resolved from the *trusted* token, never the request)
  creates the tenant-global account, grants a `member` Membership, atomically links the member
  (`linkUserId` CAS), marks the email verified (the link proves ownership), records the onboarding on
  the tenant audit chain, and auto-logs-in. scrypt runs only after a valid token is consumed (no DoS
  amplification); a replayed/expired token and an already-taken email are handled (400/409). The flow
  was adversarially reviewed (hijack/escalation, races/orphans, enumeration/DoS). `email.invite.*`
  en/sv copy + `NotificationsService.sendMemberInvite`. The admin Invite button + member accept page
  build on this next.
- **Member-invite foundation** (onboarding, first step). A tenant-global, single-use `MemberInviteToken`
  collection that *carries* its `tenantId` + `memberId` + email so the (future) public accept endpoint
  can resolve the tenant from the trusted token without a tenant context; only `sha256(token)` is stored,
  TTL-reaped, purged on member erasure. `MemberRepository.linkUserId` atomically links an account to a
  member only if it has none yet (CAS) — a replayed accept can't hijack an onboarded member. Domain
  `memberInviteAcceptSchema`. The invite service + endpoints + emails + UI build on this next.
- **Member create + edit UI** in the admin SPA (the backend POST/PATCH existed but had no UI). An
  "Add member" form on the Members list and an "Edit profile" form on the member detail page, sharing
  one accessible `MemberForm` component (first/last name required; email/phone/DOB/notes optional →
  null when blank; status dropdown). New `@obikai/api-client`-backed `createMember`/`updateMember`
  bindings; i18n (en + sv). A dojo can now add and edit members through the app.
- **Account-recovery screens** in the member portal — the same forgot/reset/verify public routes and
  "Forgot your password?" link as the admin SPA, so a locked-out member can recover their account
  (en + sv, accessible). The in-portal change-password awaits a member account page.
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
