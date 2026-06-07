# Obikai GDPR Compliance Audit — 2026-06

> **Remediation status (2026-06).** The launch-blocking findings have been actioned. Shipped: the
> per-tenant tamper-evident audit log + member-mutation auditing (H9/H2, #53/#54), self-service
> **consent** (H8, #55), the executable **ROPA registry** (#56), data-subject **export** (H7, #57),
> right-to-**erasure** (H4/H6, #58), a fail-safe tenant-isolation coverage test (#59), **PII-in-logs**
> fixes (M-mongo-leak, #60), **EU data-residency** enforcement (M-residency, #61), and the structural
> **external-AI PII gate** (M-ai-gate, #62). The `@obikai/gdpr` package is now wired (H1 resolved) and
> the worker no longer fakes success.
>
> **Still open** (tracked in `docs/refactor-backlog.md`): waiver-blob **envelope encryption /
> crypto-shred** (H5 — backup-proofing; needs the waiver upload routed through the API, a decision the
> owner has not yet made); **retention-sweep** job (M-retention — latent: nothing is within years of
> its retention bound yet); **guardian-mediated** rights for minors (M-guardian — Art. 8, a feature);
> storage tenant-prefix facade and out-of-band audit head-anchoring (pre-GA).

**Scope:** GDPR posture of the Obikai dojo-management SaaS against CLAUDE.md invariant 6 ("EU-first
compliance is core, not later"). Findings are read-only, independently verified (multi-agent: 10
dimension finders → adversarial per-finding verification → synthesis; 44 confirmed findings), and
severity-rated against real-world data-subject / regulatory risk at the current **pre-launch /
Phase-0** stage.

> Severity note: nothing is rated **Critical**. By the pre-launch yardstick (no live data subjects),
> these are *absent capabilities*, not active breaches. They become Critical the moment real member
> data — especially children's — is processed.

---

## 1. Executive summary

**Obikai is not GDPR-ready, and the gap is not subtle: the entire data-subject-rights layer is
non-functional.** The dedicated `@obikai/gdpr` package (532 LOC across consent, audit, erasure,
export, ropa) is well-designed scaffolding with **zero runtime importers** — it is not even a declared
dependency of the running `api` or `worker` processes, so none of it executes. The single biggest gap:
**a data subject cannot exercise access (Art. 15), portability (Art. 20), erasure (Art. 17), or consent
withdrawal (Art. 7) through any code path** — there is no DSAR endpoint, the worker's
`gdpr-export`/`gdpr-erasure` handlers are no-op stubs that log-and-return, and the ROPA registry meant
to drive both is never populated.

The mitigating reality: this is pre-launch with no live personal data, the architectural seams are
genuinely sound, and tenant isolation (the control that actually matters for multi-tenant PII
confidentiality) is real and enforced today. **The work is wiring, not redesign** — but it is
launch-blocking.

**Posture at a glance**
- Enforced GDPR machinery at runtime: **~0%** of the `@obikai/gdpr` package.
- Working data-subject rights: **1 of ~6** (Art. 16 self-rectification only).
- Strong foundations already in place: tenant isolation, the platform-plane audit chain, EU-safe
  defaults, PII-disciplined logging.

---

## 2. Critical & High — must fix before handling real personal data

### H1 — `@obikai/gdpr` has zero importers; it is off the runtime dependency graph
- **GDPR basis:** Arts. 15, 17, 7, 30, 5(2) — all undeliverable.
- **Evidence:** no `from '@obikai/gdpr'` anywhere; `apps/api/package.json` and
  `apps/worker/package.json` don't even list it as a dependency. `docs/refactor-backlog.md` (B8) already
  concedes it.
- **Note (correction to raw finding):** a *separate*, genuinely-wired audit log runs — but it lives in
  `@obikai/db` (`platform-audit.ts`, scheme `obikai-platform-audit-v1:`) and is **platform-scoped**
  (cross-tenant admin access). The per-**tenant** data-subject audit chain, consent, ROPA, export, and
  erasure are all undelivered.
- **Fix:** add `@obikai/gdpr` as a real dep of worker (and api for DSAR), implement the injected ports
  against `@obikai/db`, and add a CI dependency-graph guard so a compliance module with zero live
  importers fails the build. Reconcile the two hash-chain implementations when wiring.

### H2 — Worker `gdpr-export`/`gdpr-erasure` handlers are no-op stubs (false-success footgun)
- **GDPR basis:** Arts. 15 / 17 — silently non-functional.
- **Evidence:** `apps/worker/src/main.ts:148-156` — both cases only `log.info(...)` and return; job
  names are registered (`queues.ts:26-27`), so an enqueued job **completes "successfully" having done
  nothing** — worse than failing.
- **Fix:** implement against real services driven by the ROPA registry inside `runInTenantContext`.
  **Until implemented, make the stubs `throw`** so a DSAR job fails loudly.

### H3 — No data-subject-rights API endpoint exists — a DSAR has no entrypoint
- **GDPR basis:** Arts. 12, 15, 16, 17, 7.
- **Evidence:** none of ~28 controllers is a consent/export/erasure/DSAR controller; the api has no
  queue infra, so it cannot even enqueue the `gdpr-*` jobs. `DELETE /members/:id`
  (`members.controller.ts:92-100` → `members.service.ts:70-75` → `member.ts:156-157` `deleteOne`) is
  plain CRUD deletion, **not** Art. 17 erasure.
- **Fix:** add a DSAR controller (`POST /me/data-export`, `POST /me/erasure`, plus admin-initiated
  equivalents) that, after identity/consent checks and audit logging, enqueues subject-scoped jobs.

### H4 — Right-to-erasure is unimplemented and unreachable end-to-end (Art. 17)
The most-confirmed gap; several independent defects mean **an erasure request deletes nothing**:
- `ErasureService` is interface-only (`erasure.ts:108-110`); `IdentityMap`/`CryptoShredKeystore` too.
- Job payload can't identify a subject: `queues.ts:51-53` `BaseJobData { tenantId }` — no `subjectId`.
- The ROPA registry that drives erasure is never populated (`RopaRegistry.register()` never called).
- No cascade: the only working delete removes one `Member` row; Attendance, Booking, WaiverSignature,
  Promotion, GradingResult, Invoice, PaymentAttempt, Household, Membership, Identity, Session, and the
  tenant-global User are left intact.
- **Fix:** implement `ErasureService` driven by a populated ROPA registry (per-model
  `hard_delete`/`anonymize`/pseudonymize-by-reference/`crypto_shred`/`retain`); add `subjectId`+`requestId`
  to the payload; wire api producer + worker handler; emit a completion audit entry; add a test that
  enumerates every Mongoose model and fails if one is unhandled.

### H5 — Crypto-shred does not exist; immutable rows store PII in plaintext
- **GDPR basis:** Arts. 17(1), 25, 32. ADR-0007 calls per-subject crypto-shred a non-deferrable Phase-0
  requirement (backups written unencrypted now could never be erased).
- **Evidence:** no keystore / `DATA_MASTER_KEY` envelope encryption / encrypt-decrypt code exists
  (`DATA_MASTER_KEY` is used only for the fs-presign HMAC). `waiver.ts:64,68,69` store
  `signedByName`/`ip`/`documentStorageKey` as plaintext, create/read-only; blob upload hands the client a
  plain presigned PUT (`waivers.service.ts:206-216`).
- **Fix:** implement per-subject/per-object envelope encryption for blobs **now**, before production
  backups exist. For plaintext PII in immutable rows, use pseudonymize-by-reference via the IdentityMap.

### H6 — No IdentityMap; immutable promotion/grading/audit rows embed plaintext subject ids
- **GDPR basis:** Art. 17 vs immutability; Art. 5(1)(c) minimization.
- **Evidence:** `rank.ts:455,463` (`PromotionDoc.memberId`/`awardingUserId`), GradingResult, Curriculum
  Completion, and `platform-audit.ts:30,34` fold subject ids/IP into hash chains as required plaintext;
  `memberId` resolves to name/email/DOB.
- **Fix:** introduce the IdentityMap collection; migrate immutable schemas to store `PseudonymRef`
  tokens so map-row deletion severs identity while preserving counts/hash chains. Do this **before** real
  data exists (otherwise it needs a data migration).

### H7 — Data-subject export is completely unwired (Arts. 15 / 20)
- **Evidence:** `export.ts` is a pure contract; the registry-driven algorithm walks `RopaRegistry.list()`,
  but the registry is never populated → even a wired export yields `sections: []`. No endpoint, no
  working job, package not installed.
- **Fix:** install in api+worker; build a `RopaRegistry` at boot with a `ProcessingRecord`
  (`findBySubject`+`toExport`) per PII collection; implement `ExportService`; authenticated endpoint
  enqueues `gdpr-export`; worker assembles → JSON → storage → short-lived signed download.
  **Explicitly include tenant-global identity PII** (`User.email`, `Session.ip/userAgent/lastUsedAt`) via
  parallel global ProcessingRecords keyed by `userId`.

### H8 — Consent has zero runtime capability (Arts. 6(1)(a) / 7)
- **Evidence:** `consent.ts` is types + Zod + an un-implemented `ConsentRepository` port; no consent
  model in `@obikai/db`, no controller, no grant/withdraw endpoint, `record()` has zero callers.
- **Mitigation:** no marketing/broadcast sender is wired yet, so nothing live relies on absent consent.
- **Fix:** append-only `ConsentModel` (tenantGuard; withdrawal = new status row, never overwrite grant
  evidence; indexed by `tenantId,subjectId,purpose`); implement the port; member-facing grant + withdraw
  endpoints; make `listForSubject` a hard precondition in any Art-6(1)(a) processing path. Launch-blocking.

### H9 — GDPR-defining events aren't auditable; the live member-delete endpoint is unaudited
- **GDPR basis:** Art. 5(2) accountability, Art. 5(1)(f) integrity.
- **Evidence:** erasure/export/consent don't run, so they can't be logged. `DELETE /members/:id` →
  hard `deleteOne` with **no audit append**, and roles are *already* wired
  (`tenancy.middleware.ts:41-49`, `catalog.ts` grants owner `member:delete`) — so an owner can permanently
  delete a member today with no recorded actor/timestamp/IP.
- **Fix:** append `member.delete` (actor, targetId, ts, IP) before the delete; apply to all member
  mutations; implement+audit export/erasure/consent (H4/H7/H8).

---

## 3. Medium / Low (abridged — full evidence in the audit transcript)

**Medium**
- **No EU-residency enforcement (Arts. 44-49):** defaults are EU-safe (`S3_REGION=eu-north-1`) but
  `S3_REGION`/endpoint are unconstrained free strings; one env override silently creates a third-country
  transfer. → add a `DEPLOY_MODE=hosted` EU allow-list + audited escape hatch + CI drift check.
- **Advertised external-AI PII gate has no implementation:** `AiRequest.containsPersonalData` /
  `AiPersonalDataRefusedError` are contract-only; safe today (AI off) but a regression trap. → implement
  as a shared proxy over any non-local `AiPort` + contract test; fix misleading ADR-0005 comments.
- **No retention enforcement (Art. 5(1)(e)):** `Retention` type consumed nowhere; no sweep job, no TTL.
  → platform `retention-sweep` job over the populated registry.
- **ROPA runtime-empty (Art. 30):** no `ProcessingRecord` ever registered. → boot-time per-module
  registration + serialize to a generated ROPA artifact.
- **Per-tenant GDPR audit log unwired (Arts. 5(2), 30, 33):** the wired log is platform-scoped only;
  member CRUD/promotions/waivers/login produce zero per-tenant entries. → wire the gdpr `AuditLogRepository`
  + invoke on personal-data mutations + per-tenant verification endpoint.
- **Export omits tenant-global identity PII by construction:** `findBySubject` is tenant-scoped but
  User/Identity/Session are tenant-global. → fold into H7.
- **Mongo E11000 leaks registrant email into the API error log:** raw `MongoServerError` reaches the
  default logger; auth create path is the only one not translating 11000 (cf. billing/rank/scheduling/
  platform-audit). → translate in `UserRepository`/`IdentityRepository.create` + redacting global
  `ExceptionFilter`.
- **Guardian-mediated rights unreachable (Art. 8):** `can()` has a guardianship branch but no call site
  passes `guardianships` and no Guardianship model exists; fails closed. → load grants + thread through
  `can()`.

**Low**
- No fail-safe tenant-guard default / no CI coverage test (every PII model *is* guarded today, but a
  future model could silently skip it). → test enumerating `mongoose.models` against a tenant-global
  allow-list.
- CLI bootstrap scripts + local-auth provider log emails (rare/neutralised, but a wiring change from
  leaking). → log `userId` only.
- `/files` isolation is per-feature key-namespacing + HMAC, not a choke point. → centralize tenant-prefix
  in a TenantContext-aware storage facade.
- InvoiceCounter tenant-global via hand-written filter (no PII). → regression test pinning `tenantId`.
- ROPA "every PII model registered" CI guard is a comment, not code.
- Dead `gdpr-*` job vocabulary + unused `gdprRequest` RBAC resource imply capability that isn't there.

**Info**
- Tenant audit `diff` PII-minimization is convention, not enforced (Zod-constrain when wiring).
- Platform audit backward-hash-chain tail-truncation limit is honestly disclosed (ADR-0023); add
  out-of-band head anchoring before GA.

---

## 4. What is already done well

- **Cross-tenant isolation is structural and enforced at runtime.** The `tenantGuard` plugin injects
  `{tenantId}` into every read/update/delete (incl. lean), stamps writes, covers `insertMany`,
  recursively scopes aggregation sub-pipelines, bans `$merge`/`$out`, and **throws** on missing context
  rather than widening scope. Verified applied to every PII-bearing collection. This is the control that
  actually matters for multi-tenant PII, and it holds.
- **The platform/cross-tenant audit log is genuinely wired, tamper-evident, and PII-disciplined.**
- **EU-safe-by-default posture:** `eu-north-1`, local MinIO, operator SMTP, payments `manual`, SMS
  `disabled`, VAT `none`, AI `none`. Invariant 4 holds (no PII to a model provider by default).
- **Disciplined, PII-minimizing logging by default** (operational identifiers only; the few leaks are
  narrow, identified auth-path exceptions).
- **The GDPR design itself is correct** — consent model, ROPA/`ProcessingRecord` shape, registry-driven
  export/erasure, pseudonymize-by-reference + crypto-shred, per-tenant hash-chained audit. The hard part
  (the seams/contracts) is largely done. **The remaining job is wiring + implementation, not redesign.**
- **The team is honest about the gap** (backlog B8, ADR-0007).

---

## 5. Prioritized remediation plan

**Phase A — Make the GDPR package real (unblocks all rights)**
1. Add `@obikai/gdpr` as a dependency of worker + api; add the CI dependency-graph guard (H1). Make the
   worker stubs `throw` as an interim so a DSAR job can't report false success (H2).
2. Implement persistence in `@obikai/db`: append-only `ConsentModel`, per-tenant `AuditLogRepository`,
   `IdentityMap`, `CryptoShredKeystore` / envelope encryption (H5, H6, H8, H9). Do crypto-shred + the
   IdentityMap **now**, before any production data/backups exist.
3. Populate the ROPA registry at boot — one `ProcessingRecord` per PII collection (incl. tenant-global
   identity) — and add the CI guard that fails when a PII model is unregistered (H4, H7).

**Phase B — Implement the rights + their audit trail**
4. **Erasure:** `ErasureService`; `subjectId`+`requestId` payload; real worker handler; route admin
   `DELETE /members` through it; completion audit entry; model-enumeration test (H4, H5, H6, H9).
5. **Export:** `ExportService`; real worker handler → JSON → storage → signed download; include
   tenant-global identity PII; non-empty-bundle test (H7).
6. **Consent & audit wiring:** grant/withdraw endpoints; consent as a precondition; per-tenant audit log
   on all personal-data mutations; per-tenant chain-verification endpoint (H8, H9).
7. **DSAR controller + RBAC:** `/me/...` + admin-initiated endpoints; grant `gdprRequest`; thread
   `guardianships` into `can()`; round-trip smoke test (H3).

**Phase C — Storage-limitation, residency, hardening**
8. `retention-sweep` platform job over the populated registry.
9. EU-residency enforcement in `@obikai/config` (allow-list + audited escape hatch + CI drift check).
10. Fail-safe tenant-guard coverage test.
11. PII-in-logs fixes (auth 11000 translation / redacting `ExceptionFilter`; strip emails from CLI +
    local-auth logs).

**Phase D — Pre-GA**
12. External-AI PII gate (shared proxy + contract test); centralize storage tenant-prefix; out-of-band
    audit head-anchoring; InvoiceCounter regression test.

**Bottom line:** the architecture is right and the foundations (isolation, platform audit, EU defaults,
log hygiene) are solid, but the entire data-subject-rights layer is dead code today. **Phases A and B
are launch-blocking and must be complete and tested before any real member data is processed.**
