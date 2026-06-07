# Obikai Launch-Readiness Assessment — 2026-06

Honest "how far are we / what's left to go live" map, produced by a multi-agent assessment (11
read-only dimension assessors → synthesis) against `docs/scope.md` and the CLAUDE.md invariants. No
time pressure assumed — this is a complete map of remaining work, not a green light.

> Maturity legend: **solid** (production-ready) · **partial** (works, real gaps) · **scaffold**
> (types/stubs, not wired) · **missing**. Effort: S < M < L < XL.

---

## 1. Overall posture

The **architecture is sound and the hardest algorithmic work is behind us** — the rank/grading engine,
the invoicing/dunning ledger, the auth primitives, multi-tenant isolation, and (as of PRs #53–#63) the
GDPR layer are genuinely strong. What stands between here and a paying launch is mostly **disciplined
integration and surface-building over good seams** — substantial, but low-risk if sequenced well.

Realistically this is **several focused months** to a safe hosted launch. The two long poles are
**(1) a real payment provider + webhook path** and **(2) the missing onboarding / admin / rank-authoring
UIs** — a dojo currently cannot run its business through the product.

**Hosted and self-host launches fail for different reasons.** Hosted is blocked mainly by the money
path, the UIs, and the platform-provisioning surface. Self-host is *additionally* blocked by things
silently broken in the default single-box config: the in-process worker isn't wired (so **a default
self-host install runs no billing or dunning at all**), there's no migration runner, no backups, no
docs, and the prod compose can't pull the right images.

---

## 2. Go-live blockers

### A. The money path (the product's reason to exist)
- **A1. No real payment provider — dues cannot be collected. [XL]** Only `payments-manual` +
  `payments-stub` exist; config advertises stripe/swish/autogiro/vipps and validates `STRIPE_SECRET_KEY`,
  but no factory exists so selecting any fails at boot. The Nordic rails (Autogiro/Swish/Vipps) — the
  differentiator — are unbuilt.
- **A2. No payment webhook receiver. [L]** Invariant 9 requires payment state via signed webhooks; there
  is no webhook controller in `apps/api/src`. `recordPaymentResult` is called only from tests, so invoices
  never flip paid/failed.
- **A3. No charge/mandate is ever triggered; no `PaymentsPort` instantiated in the API. [M–XL]**
  `enrollments.service.create()` flips status to active with no mandate setup; capabilities only echo the
  configured provider id.
- **A4. Self-host manual default can't record an offline payment. [M]** Invoices controller has no
  "mark paid" route, so a cash/bank-transfer dojo's invoices age forever and get auto-dunned to
  uncollectible (freezing the member).
- **A5. Manual payments adapter keeps mandates/charges in process memory. [M]** Lost on restart.

### B. Background jobs that move money silently don't run
- **B1. Self-host default runs ZERO background jobs. [M]** Default is `RUN_WORKER_IN_PROCESS=true` but the
  API never starts a worker (ADR-0017 admits it), and the standalone worker is labelled "optional" in
  compose → a default install processes no recurring invoices and no dunning.
- **B2. No retry/backoff or retention on any job. [S]** `queue.add` with no options → `attempts:1`; a
  transient blip permanently drops a tenant's billing run; completed/failed jobs accumulate unbounded.
- **B3. Dunning never re-charges and never notifies. [L]** `advanceDunning` only increments the stage and
  finally freezes the enrollment — no re-attempt, no email.

### C. Transactional communications are wired to nothing
- **C1. `NotificationsService` is built/tested but invoked by no real flow. [L]** Receipts, dunning
  notices, waiver requests, reminders are never sent in production.
- **C2. Worker `reminders` job is a do-nothing stub. [M]**
- **C3. No receipt/confirmation delivered on payment. [M]** (Resolves once A2 + C1 land.)
- *B3 + C1–C3 are one coordinated "wire the notification + recovery path" workstream.*

### D. Onboarding & core admin UI — a dojo can't run its business
- **D1. No membership/invite API or UI. [XL]** The only path that creates a `Membership` is the
  `create-owner` CLI; a dojo owner cannot add instructors/staff/members/guardians through the app.
- **D2. No member create/edit in the admin UI. [L]** Back-end CRUD exists; the SPA only lists/gets.
- **D3. No rank-system authoring UI + no template library. [XL]** The product core. Back-end can
  validate/publish/version rank systems, but nothing in `web-admin` calls it, and there is **zero**
  template/seed data (no BJJ/Karate/Judo/kyu-dan ladders). A non-technical owner cannot stand up a rank
  system except by hand-crafting JSON.
- **D4. No billing/enrollment UI. [L]** No screen enrolls a member, captures a payment method, or
  freezes/cancels a subscription.
- **D5. No waiver UI (incl. minor/guardian). [L]** Liability/compliance requirement for children.
- **D6. Platform app can't provision/manage/suspend/bill a tenant. [L]** `web-platform` is read-only —
  hosted customer onboarding has no UI.

### E. Auth & account lifecycle
- **E1. No password reset / forgot-password. [L]** Forgetting = permanent lockout.
- **E2. No email verification (`emailVerified` always false, never enforced). [M]**
- **E3. No password-change endpoint + no session revocation on credential change/suspend. [M]**
  `revokeAllForUser` exists but is never called.
- **E4. JWT secret placeholder passes validation. [S — do first]** `.env.example` ships a 34-char
  `change-me-…` that passes the min-32 check → a self-hoster who skips it ships a publicly-known signing
  key (cross-tenant account takeover).
- **E5. API has no security headers (helmet) and no CORS policy. [M]** Hardened headers cover only the
  static SPA tier, not the JSON API serving credentials + children's PII.
- **E6. Brute-force limiter is per-IP and in-memory. [M]** Doesn't hold across instances (hosted scales
  horizontally); use the already-mandatory Redis + per-account lockout.

### F. Operability — you'd be blind in production
- **F1. `/readyz` is a hardcoded all-true stub. [M]** (`isMongoConnected()` already exists, unused.)
- **F2. No global exception filter. [M]** Unmapped errors → bare 500, no structured log / request-id /
  tenant-id.
- **F3. No structured API logging; auth events silently discarded. [M]** The auth adapter is injected a
  no-op `silentLogger` → failed logins/lockouts produce zero output.
- **F4. API has no graceful shutdown. [S]** In-flight requests severed on every deploy; Mongo not closed
  cleanly (risk of truncated billing/PII writes). The worker already does this — copy it.
- **F5. No metrics, tracing, or error tracking. [L]** Outages discovered by customer complaint.

### G. Deployment & self-host integrity
- **G1. No working DB migration runner. [L]** `migrate.ts` is config/types only; `migrate-mongo` isn't a
  dependency; schema/indexes rely on Mongoose `autoIndex`.
- **G2. Mongo + Redis run with no authentication in all compose configs. [M]** Datastores holding
  children's PII are unauthenticated (and the dev override publishes 27017/6379).
- **G3. No backup/restore mechanism or docs. [M]** Scope §3 requires it as a first-class deliverable.
- **G4. Web SPA images never published; absent from every compose file. [L]** The product has **no front
  door** at go-live.
- **G5. Prod image references don't match what release publishes. [S]** `ghcr.io/obikai/api` vs
  `ghcr.io/<owner>/obikai-api`.
- **G6. No self-host/deploy/upgrade documentation. [L]** Scope §3: the self-hosting guide is first-class.
- **G7. `SEED_ON_START` parsed but never acted on. [S]** Documented first-run bootstrap is a dead flag;
  the working `create-owner` CLI is undocumented.

### H. i18n — fails the Nordic-first promise
- **H1. nb/da/fi are untranslated English copies; sv only partial. [L]** Invariant 6 needs all five day
  one (UI **and** transactional email).
- **H2. No language switcher/detector/persistence; `lng` hardcoded to `en`. [M]** Even partial
  translations are unreachable.
- **H3. `<html lang>` is static `en`. [S]** Concrete WCAG 2.1 AA 3.1.1 failure.
- **H4. Translatable rank/curriculum content is a dead type. [L]** `LocalizedString` unused; names stored
  as plain strings — a schema change (pairs with G1's migration runner).

### I. Testing gaps that hide the above
- **I1. No HTTP/controller integration tests. [L]** All 31 controllers, DTO validation, the auth guard,
  tenancy middleware, and RBAC are tested only as isolated units with fakes — a miswired controller could
  pass the whole suite and leak one dojo's children's data to another. (`supertest`+`@nestjs/testing`
  already devDeps.)
- **I2. Tenant isolation proven only at the Mongoose-plugin layer, never through a real authenticated
  request. [M]**
- **I3. Worker/Redis/BullMQ has zero integration coverage. [M]** A broken cron / unregistered processor
  stays green while no dojo gets billed.

---

## 3. Should-fix soon after launch / hardening

Proration on mid-cycle freeze/cancel (helper exists, unused); EU B2B reverse-charge computed (rendered
but always false; VIES exists, unwired); refunds; rank views render raw step IDs (needs a human-name on
`Step`); **youth→adult transition wired into the product** (pure fn called from nowhere — scope §4.5
table stakes); access-token liveness / `User.status` enforcement; per-account lockout/backoff; echo
`x-request-id` + access log; process-level `uncaughtException`/`unhandledRejection`; coverage thresholds
in CI on money/auth/tenant packages; **GDPR self-service UI** (back-end shipped, UI missing);
standardized error-body shape; `migrate` compose service + disable prod `autoIndex` + real `/readyz`
checks; nb/da/fi/en email catalogs; de-dup email catalogs + parity check; bounce/suppression handling;
`passedGradingEvent.sinceStepId` dead config (implement or remove); award atomicity (replica-set txn).

---

## 4. Post-launch (real but deferrable)

AI-assisted setup (scope §13); grading-event & curriculum management UI; certificate / roster /
belt-label output; school-wide "who's ready" dashboard; member-portal engagement (booking, self-edit,
curriculum checklist); instructor progression notes; a real SMS adapter; push notifications / in-app
center / broadcast messaging; household payer-rollup + class-pack/term billing; Stripe Connect / payout
routing + revenue analytics; React Native member app; Helm chart; opt-in telemetry; Playwright e2e +
load/soak + PSP webhook replay tests; MFA/TOTP; OIDC adapter; `buildInput` perf (`findLatest()`); the
dead `gdpr-export`/`gdpr-erasure` async job vocabulary.

---

## 5. What's genuinely strong already

- **The rank/grading engine — production-grade and the standout.** Pure, content-addressed
  (`versionId` = SHA-256 of canonicalized config), Temporal-based exact decimal math, "belt" provably
  presentation-only across belts/kyu-dan/levels/belt-less, versioned + immutable history, human-in-loop
  structurally enforced with AI provably off the rank path, fast-check property tests + a CI purity guard.
- **The invoicing/dunning ledger** — gapless atomic per-tenant numbering, idempotency throughout, integer
  minor-unit money with property-tested VAT/proration, compliant invoice PDF.
- **The payments *abstraction*** — genuinely vendor-neutral (one Mandate/Charge model, signature-verifying
  webhook gateway covering cards/SEPA/Autogiro/Swish/Vipps/SCA). The seam is right; only the impl is missing.
- **Auth primitives** — opaque rotating refresh tokens (hash-stored), family reuse-detection via CAS,
  roles re-resolved per request, scrypt + timing decoy, deny-by-default RBAC, separate platform plane.
- **Multi-tenant isolation** — real and tested at the data layer against the genuine leakage vectors
  (`$lookup`/`$merge`/`$out`/`insertMany`/missing-context). Gap is proving it through HTTP (I2).
- **Worker foundation** — explicit per-tenant context, audited platform step, real graceful shutdown,
  idempotent fan-out.
- **Deployment scaffolding bones** — multi-stage non-root images, clean 3-file compose, hardened release
  (multi-arch, cosign, SBOM), Zod fail-fast config, EU-residency allow-list.
- **Web app bones** — one shared tested API client (silent re-auth, transparent 401-retry) across all
  three SPAs; the built slices (rank eligibility/award, scheduling→materialize→roster→attendance) are
  genuinely end-to-end.
- **GDPR** (PRs #53–#63) and the **communications layer** (built, just unwired).

---

## 6. Suggested sequence to launch

- **Step 0 — cheap, severe quick wins (days):** E4 (reject placeholder JWT secret), F4 (graceful
  shutdown), B2 (job retry/retention), G5 (image names), H3 (`<html lang>`), G7 (seed-flag honesty).
- **Step 1 — safe to expose + observable:** E5 (helmet+CORS), E6 (Redis rate-limit + per-account), F1
  (real `/readyz`), F2 (global exception filter), F3 (structured logging + un-silence auth), F5 (min
  metrics + error tracking).
- **Step 2 — close the money path (longest pole):** one real PSP (Stripe first) → A1; webhook receiver →
  A2; wire adapter + fire charges/mandates → A3; self-host "mark paid" → A4; durable manual storage → A5.
- **Step 3 — wire jobs + notifications (one workstream):** B1 (worker actually runs), then B3 + C1–C3.
- **Step 4 — account lifecycle:** E1 (reset), E2 (verification), E3 (change + revocation).
- **Step 5 — make a dojo able to run its business (UI):** D1 (membership), D3 (rank authoring + **seed a
  template library first**), D2, D4, D5, D6.
- **Step 6 — i18n:** H4 (translatable schema, with G1), H2 (switcher), H1 (complete sv + nb/da/fi).
- **Step 7 — self-host integrity:** G1 (migrations), G2 (datastore auth), G3 (backups), G4 (publish SPA
  images), G6 (docs).
- **Step 8 — prove it before charging:** I1, I2, I3 + coverage thresholds.

**Go-live split:** *Hosted* can launch after Steps 0–6 + 8 (G2 + observability mandatory; G1 migrations
and G3 backups non-negotiable). *Self-host* additionally requires all of Step 7 — not "done" until a
fresh operator can stand up, secure, bootstrap, back up, and upgrade from docs alone.

**Net:** the architecture is sound and the hardest work is behind you. What remains is mostly disciplined
integration over good seams — with the **payment path** and the **onboarding/rank-authoring UIs** as the
two long poles to start now.
