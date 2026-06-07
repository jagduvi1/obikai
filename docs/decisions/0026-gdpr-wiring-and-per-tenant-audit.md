# 0026 — GDPR wiring: db→gdpr dependency + per-tenant audit log

**Status:** Accepted · 2026-06-07

## Context

The 2026-06 GDPR audit (`docs/gdpr-audit-2026-06.md`) confirmed that `@obikai/gdpr` — consent, the
per-tenant hash-chained audit log, ROPA/retention, export, erasure — has **zero importers**: it is
well-designed scaffolding that nothing on the runtime graph reaches, so none of invariant 6 is
actually enforced. Remediation requires implementing the package's injected ports against real
persistence and wiring them into the api/worker.

Two structural questions had to be settled before any code could land:

1. **Where do the gdpr port implementations live?** The package is deliberately DB-free; its ports
   (`AuditLogRepository`, `ConsentRepository`, `IdentityMap`, `CryptoShredKeystore`) are "injected by
   the app layer." But every other Mongoose model/repository in the system lives in `@obikai/db`, and
   the import boundary (ADR-0003) previously allowed `db → { domain, config }` only — so `db` could not
   even reference the gdpr port interfaces or reuse its pure hash-chain functions.
2. **Per-tenant vs platform audit.** ADR-0023 built a *platform* (tenant-global) audit log for
   cross-tenant admin access. The GDPR audit (Art. 5(2)/30) requires a *per-tenant* accountability
   record for personal-data actions. These are different chains with different scopes.

## Decision

- **Allow `db → gdpr` in the import boundary.** `gdpr` depends only on `domain` + `adapter-contracts`
  and never imports `db`, so `db → gdpr` is acyclic. This lets the concrete repositories live in
  `@obikai/db` (consistent with every other model) while reusing gdpr's pure, isomorphic hash-chain
  primitives instead of reinventing them. The app layer still *injects* the db-provided repos into the
  gdpr-defined services — the "ports injected by the app" intent is preserved; only the home of the
  adapter moves to db. The crown-jewel rule (`rank-engine` may import only `domain`) is untouched.
- **A per-tenant `AuditLogRepository` in `@obikai/db`** (`audit-log.ts`), built on gdpr's
  `appendEntry`/`hashChainEntry`/`verifyChain` (scheme `obikai-audit-v1:`). It is **tenant-scoped**
  (the `tenantGuard` plugin scopes every read/write — distinct from the tenant-global platform log)
  and **append-only** (no update/delete path).
- **Order anchored by a monotonic per-tenant `seq`**, unique-indexed as `{tenantId, seq}`, exactly as
  the platform log (ADR-0023): clock/ObjectId order is unsafe across replicas and clock steps. `seq`
  is storage-only — never part of the hashed payload, never in an `AuditLogEntry`.
- **Forks impossible by construction:** unique `{tenantId, seq}`, `{tenantId, prevHash}`,
  `{tenantId, hash}`. A concurrent append that loses the race re-reads the advanced head and retries
  (bounded by `MAX_APPEND_ATTEMPTS`); beyond the bound it throws loudly rather than dropping an event.
- **Optional fields (`diff`, `ip`) are stored ABSENT, never `null`,** so canonical hashing
  (which omits `undefined` but keeps `null`) round-trips: a stored `null` would silently break
  verification.

## Consequences

- The gdpr package can now be implemented and wired (this is the first of the Phase-A remediation PRs).
  Subsequent PRs add `ConsentRepository`, `IdentityMap`, `CryptoShredKeystore`, the ROPA registry, and
  the export/erasure services on the same db→gdpr seam.
- There are two parallel hash-chain implementations (`platform-audit.ts` using `node:crypto`,
  tenant-global; and this per-tenant log using gdpr's `@noble/hashes`). They are intentionally separate
  (different scope, scheme, and the gdpr chain must stay browser-isomorphic). A future consolidation is
  possible but not required.
- Every personal-data mutation can now record a tamper-evident, per-tenant trail; an auditor can pull
  the tenant's chain and run `verifyChain`. Wiring the call sites (member CRUD, promotions, consent,
  export/erasure) follows in the next PRs.

## Alternatives considered

- **Put the gdpr port impls in the app layer (`apps/api`/`apps/worker`).** Allowed by the existing
  boundary (app may import both db and gdpr), but it would scatter Mongoose schemas outside `@obikai/db`,
  breaking the "all models in db" convention and splitting persistence across layers. Rejected.
- **Duplicate the gdpr entry types + hash functions inside `db`** to avoid the dependency. Rejected —
  guaranteed drift between two copies of security-critical crypto; the whole point of the gdpr package
  is to own these primitives once.
- **Reuse the platform audit chain with a per-tenant sentinel.** Rejected (already in ADR-0023): it
  overloads tenant semantics; the per-tenant chain belongs under the tenant guard.
