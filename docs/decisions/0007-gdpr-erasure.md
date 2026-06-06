# 0007 — GDPR erasure: pseudonymize-by-reference + per-subject crypto-shred

**Status:** Accepted · 2026-06-06

## Context

Invariant 6: GDPR is core — export, right-to-erasure, consent records, audit log, documented
controller/processor split. This collides with two hard constraints: **immutable promotion
history** (invariant 5) and **statutory financial retention** (Nordic bookkeeping ~7 years; VAT
invoices). A naive "hard delete" would either corrupt rank history / others' grading-event
integrity, or break legal retention.

## Decision

A **typed ROPA/retention registry** enumerates every PII-bearing model (purpose, lawful basis,
controller/processor role, retention, export inclusion, erasure strategy) and **drives** both
export and erasure. CI fails if a model with PII-tagged fields is not registered — GDPR
accountability is executable, not a drifting Word doc.

**Per-model erasure strategy** (`hard_delete | anonymize | crypto_shred | retain`):

- **Erasure of immutable history is pseudonymize-by-reference, never in-place mutation.** Person
  identifiers on a `PromotionLogEntry` (the awardee, and the awarder/guardian/signer who may be a
  *different* data subject) are indirected through a separate identity-map collection; erasure
  **deletes the map row**, leaving the immutable log document and its hash chain byte-identical.
  Rank statistics/counts are preserved, identity is gone.
- **Crypto-shred keys are per-subject / per-object — never per-tenant** (a per-tenant key would
  destroy every member's backups when erasing one member). Each subject's large/opaque blobs
  (waivers, photos) are encrypted under a per-subject data-encryption key wrapped by
  `DATA_MASTER_KEY` (libsodium/age, stored in Mongo); erasure destroys the wrapped key. This
  makes erasure real even for data already written to immutable backups — and it is a **Phase-0
  requirement**, not deferrable, because backups written unencrypted in the interim could not be
  erased.
- **`retain`** for invoices/financial records (legal basis: bookkeeping law) with the linked
  person anonymized.

**Controller/processor split is modeled in data:** hosted = platform is processor for member
data / controller for owner accounts; self-host = the dojo is controller for everything. A
member-erasure request on the hosted plane is routed to the controlling dojo for authorization
before execution.

**Supporting primitives (Phase 0):** consent records (purpose, lawful basis, policy version,
evidence); an **append-only, hash-chained audit log** (tamper-evident, PII-minimized diffs, no
update/delete path).

## Consequences

- Post-erasure tests assert: every promotion log entry still validates its version pin and hash
  chain; no plaintext PII for the subject remains in any registered model; rank stats unchanged.
- Erasure runs via `runInTenantContext`, so it cannot cross tenants.

## Alternatives considered

Global hard delete (illegal + corrupts immutable history); encrypt-all-PII crypto-shred
(heavy for Mongo, breaks PII search/indexing — used selectively for blobs only); prose-only
ROPA (drifts from code). All rejected.
