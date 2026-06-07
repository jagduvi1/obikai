# Refactor backlog

Findings from the 2026-06 codebase refactor audit that were **deliberately deferred** after the
correctness/perf fixes landed (PRs #46–#50). Each entry records *why* it was not done immediately and
the recommended approach, so the work can be picked up without re-deriving the analysis.

What **was** actioned from the audit:

- **#46** — worker connects to Mongo before draining DB-backed jobs; connection pool/timeout/loss
  handling; promotion rank-state advance no longer silently no-ops.
- **#47** — tests for the path-traversal guard (`resolveObjectPath`) and the youth→adult rank
  `resolveTransition`.
- **#48** — gapless invoice numbering is crash-safe (allocate-first + single atomic claim).
- **#49** — race-safe waitlist promotion (atomic CAS), `DuplicateBookingError` → 409, scheduling
  conflicts → 409.
- **#50** — occurrence materialization issues one `bulkWrite` instead of N upserts.

---

## Deferred — code health (DRY), medium priority

These are real duplication with a documented footgun, but each is a high-churn, cross-cutting change
(~16–21 files) best done as one deliberate, reviewable pass rather than bundled with bug fixes.

### B1 — Consolidate `ForbiddenError` / `NotFoundError` / `ConflictError` (audit M1/M5/M16)
`ForbiddenError`/`NotFoundError` are re-declared byte-identically in ~16–19 service files (members,
scheduling, rank, billing, …), and **again** inside the `@obikai/billing` package. This has *already*
forced a workaround: `invoices.controller.ts` must test `error instanceof ForbiddenError || error
instanceof BillingForbiddenError` because the locally-imported class and the `@obikai/billing` class
are distinct-but-identical types — the exact cross-module `instanceof` mismatch the duplication
invites.

- **Why deferred:** the *full* fix (removing the dual-`instanceof`) needs the shared classes to live
  in a package both `apps/api` *and* `@obikai/billing` can import — i.e. a small shared package or
  `@obikai/domain` — which is a design decision, not a mechanical move. An `apps/api/src/common/errors.ts`
  alone fixes the api-side duplication but not the cross-package case.
- **Recommended:** add framework-free `ForbiddenError`/`NotFoundError`/`ConflictError` to a shared
  location importable by packages (candidate: `@obikai/domain`, since they are plain `Error`
  subclasses with no framework deps). Re-export from existing service modules to avoid churning every
  importer/test at once; delete the per-file declarations; collapse the dual-`instanceof` in
  `invoices.controller`. Existing `instanceof` assertions in tests are the safety net.

### B2 — Extract `currentActor()` + `translate()` controller helpers (audit M2/M7/M15)
`currentActor()` is copy-pasted verbatim into ~21 controllers; each controller also hand-rolls a
`translate(error)` error→HTTP mapper, and the mapping has already drifted (conflict mapped to 400 vs
409 vs 422 across modules — the scheduling slice was aligned to 409 in #49).

- **Why deferred:** 21-file churn; `translate()` bodies differ per controller (different error sets),
  so a clean unification wants a small error→status registry, not a blind copy. Pairs naturally with
  B1 (a shared error module makes one shared `translate()` viable).
- **Recommended:** one `apps/api/src/common/http.ts` exporting `currentActor()` and a
  `translateError()` driven by a class→exception map; controllers call the shared mapper and register
  any module-specific extras.

### B3 — Repository boilerplate (audit M3/L4/L5 + the `TenantRepository` base, M17/L1)
~30 repeats of `created.toObject() as unknown as XDoc`; `patchFields` builders erased through untyped
`Record<string, unknown>` accumulators; two competing patterns (the largely-unused
`TenantRepository<T>` base vs hand-rolled per-entity repos).

- **Why deferred:** cosmetic/structural; low bug risk but very high file count, and a base-class
  migration is an architecture decision (do all repos extend `TenantRepository`, or keep the explicit
  style?). No correctness impact.
- **Recommended:** start with the cheap, typed `toDomain`/`patchFields` helpers; decide the
  base-class question separately before a broad migration.

---

## Deferred — needs a design decision

### B4 — Atomic capacity enforcement / distinct-member over-booking (audit M18, the capacity half)
`BookingsService.create()` still does count-then-insert (a TOCTOU): two concurrent requests for the
last seat can both observe under-capacity and both insert `booked`, over-filling by a few seats under
genuine contention. (#49 fixed the *waitlist-promotion* race and the duplicate-member 500, but **not**
this.)

- **Why deferred:** a correct fix needs a denormalized `bookedCount` on the occurrence + an atomic
  seat claim (`findOneAndUpdate({_id, bookedCount: {$lt: capacity}}, {$inc:{bookedCount:1}})`), which
  requires (a) a **schema migration** to backfill `bookedCount` on existing occurrences and (b) the
  **migrate-mongo runner**, which is configured (`packages/db/src/migrate.ts`) but **not yet built**
  (no `packages/db/migrations`, no per-tenant runner). It also interacts with the cancel/promote path
  and has subtle residual races on single-node Mongo (documented in the design notes below).
- **Recommended:** build the migration runner first (it is a prerequisite for any schema evolution),
  then add `bookedCount` with a release-first + reclaim-loop model so capacity is enforced atomically
  and no "free seat + non-empty waitlist" state persists. Blast radius today is small (a few extra
  seats, self-healing as members cancel) — acceptable until the migration runner exists.

### B5 — `/readyz` real dependency checks (audit M10)
`HealthController.collectChecks()` hardcodes every probe to `true`, so readiness can never report
not-ready — defeating the ADR-0009 observability property.

- **Why deferred:** `HealthModule` has zero DI; wiring real checks needs the Mongo handle
  (`isMongoConnected()` exists — easy), the email adapter via the config/adapter resolver (with a real
  semantic question: what should `emailTransport` report when email is intentionally **disabled** in a
  cash/AI-off self-host?), an ioredis client (BullMQ lives in the **worker**, not the api — is a redis
  check even meaningful here?), and the migrate-mongo changelog head for `migrationsApplied` (runner
  not built — see B4). Note: nothing currently routes on `/readyz` (compose/Traefik use `/healthz`),
  so the harm is latent.
- **Recommended:** wire `mongo: isMongoConnected()` now (no design question); decide per
  deployment-mode semantics for `emailTransport`; drop or defer `redis`/`migrationsApplied` until they
  are genuinely probe-able from the api. Keep `/healthz` dependency-free.

### B6 — Pagination contract for repository `list()` (audit M19)
No `list()`/`listBy*()` accepts `limit`/`cursor`; member-facing attendance + invoice history endpoints
return O(total-history) rows/payload.

- **Why deferred:** a shared `{ limit, cursor }` contract must thread through repo → service →
  controller → web client across ~7 repos, and "make pagination mandatory" is an API-contract
  decision best made before clients proliferate. Latent at foundation stage (no high-volume tenant
  yet).
- **Recommended:** do the cheap high-confidence slice first — `PromotionsService.buildInput` loads the
  *entire* promotion history just to read `history[0]`; add `findLatest()`/`exists()`. Then a deliberate
  pagination pass capping attendance + invoices.

---

## Deferred — feature work (not refactors)

- **B7 — Payments wiring (audit H1):** the manual/stub payment adapters and the webhook ingestion path
  are built but unwired (no `PaymentsPort` consumer). This is a feature, not a refactor; sequence with
  the PSP selection (a human-owned decision per CLAUDE.md).
- **B8 — `@obikai/gdpr` wiring (audit M9): ✅ DONE.** The GDPR audit (`docs/gdpr-audit-2026-06.md`) ran
  and the package is now wired end-to-end across PRs #53–#62: per-tenant audit log, consent, ROPA
  registry, export, erasure, tenant-guard coverage, PII-in-logs, EU-residency, and the external-AI PII
  gate. **Remaining GDPR items** (see the audit doc's remediation-status note): waiver-blob envelope
  encryption / crypto-shred (H5 — needs the waiver upload routed through the API, an owner decision);
  retention-sweep job (M-retention — latent); guardian-mediated rights for minors (M-guardian, Art. 8 —
  a feature); storage tenant-prefix facade and out-of-band audit head-anchoring (pre-GA).
- **B9 — `as never` type hole in `PromotionsService` (audit M8):** branded-id casts (`as never`) hide a
  type hole through the rank service layer. Low risk; tighten when touching that layer.
