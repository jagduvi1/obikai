# 0034 — Erasure via member-root anonymization (supersedes ADR-0007's mechanism)

**Status:** Accepted · 2026-06-17 · **Supersedes the erasure MECHANISM of [ADR-0007](0007-gdpr-erasure.md)**
(its accountability goals — ROPA-driven, reaches every store, executable-not-a-Word-doc — still stand).

## Context

ADR-0007 specified two mechanisms as non-negotiable: (1) erase immutable history by
**pseudonymize-by-reference** — every PII reference indirected through an `IdentityMap` collection, and
erasure deletes the map row, leaving the log document byte-identical; and (2) **per-subject crypto-shred**
of encrypted blobs, called a "Phase-0 requirement, not deferrable."

The shipped erasure (`packages/db/src/erasure-service.ts`, ADR-0026/G6) does neither: it **anonymizes the
Member root in place** (nulls its PII columns) and relies on the fact that every member-keyed reference
holds only the opaque `memberId` — so de-identifying the root de-identifies the references — and it
deletes waiver blobs from live storage rather than crypto-shredding backups. No `IdentityMap` /
`CryptoShredKeystore` was implemented. The audit (docs/gdpr-audit-2026-06) and the code's own comments
disclose this gap, but ADR-0007 — an Accepted, immutable record — still described the un-built mechanism,
violating the decisions log's own "supersede, don't edit" rule. This ADR records the decision actually
taken.

## Decision

- **Erase by anonymizing the Member root, not by an identity-map indirection.** Member-keyed rows
  (attendance, bookings, invoices, promotions, grading results, …) carry only `memberId`; nulling the
  root's PII columns (name/email/phone/DOB/emergency-contact/notes) de-identifies them all. Free-text
  columns that can embed PII independently of the root are scrubbed at the row (grading-result notes,
  promotion override reasons, waiver `signedByName`/`ip`, message-log handled by hard delete).
- **Reach every PII store via the ROPA registry + the account step.** The audit-driven follow-ups in
  this remediation register MessageLog/Guardianship/Household and add a CI guard that fails the build if
  any persisted model is neither registered nor explicitly classified — restoring ADR-0007's
  "accountability is executable" goal on top of the simpler mechanism.
- **Cross-tenant identity is preserved.** A shared login (one tenant-global `User`, many per-tenant
  memberships — ADR-0004) is only destroyed when the subject has no membership in another tenant; a
  cross-training student keeps their account when one dojo erases its membership.
- **Crypto-shred of backups is deferred, explicitly.** It is the only true defense against an
  already-written backup copy. It is **not yet implemented**: at pre-launch there are no backups, and the
  waiver blob is deleted from live storage. It becomes required before the managed service takes its
  first backup. The ROPA `crypto_shred` strategy label on `waiverSignature` therefore currently means
  "anonymize denormalized columns + delete the live blob"; the key-destruction step lands with the
  backup/KMS work.

## Consequences

- The authoritative design record now matches the code; ADR-0007's goals (completeness, executability)
  hold, its mechanism is superseded here.
- Anonymization is irreversible and idempotent (safe to re-run), but is NOT transactional across the
  ~18 collection writes on single-node Mongo; the run is ordered so the account is locked (credentials
  deleted) before the email is anonymized, and is re-runnable. Full multi-document atomicity needs a
  replica-set transaction — tracked with the same migration/replica-set work as gapless-invoice atomicity.
- **Open follow-up (tracked):** per-subject crypto-shred of backups + a KMS-backed `CryptoShredKeystore`,
  required before the hosted service retains backups.

## Alternatives considered

- **Build the ADR-0007 identity-map + crypto-shred now.** Rejected for the current phase: the in-place
  anonymization already leaves no plaintext subject PII in any registered model (references are opaque
  ids), and crypto-shred has no value until backups exist. Revisit with the backup story.
