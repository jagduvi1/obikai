# 0023 — Platform audit log

**Status:** Accepted · 2026-06-07

## Context

The cross-tenant platform plane (ADR-0021/0022) reads across all tenants (list/inspect/usage). Such
privileged, cross-tenant access must be auditable: who looked at which tenant, and when. The existing
hash-chained audit log (`@obikai/gdpr`, ADR-0007) is **per-tenant** (every entry carries a
`tenantId` and chains within one tenant) and has no db implementation yet — it doesn't fit a single
cross-tenant stream. This completes the read-only oversight v1 scope.

## Decision

- **A dedicated, single, global platform audit log** — separate from the per-tenant gdpr stream. It
  is TENANT-GLOBAL (no `tenantGuard`, like `User`/`Tenant`/`PlatformGrant`) and **append-only**: the
  repository exposes only `append` + `list` (no update/delete).
- **Tamper-evident hash chain.** Each entry's `hash = sha256(scheme + content + prevHash)` over a
  JSON-array serialization of the fields (escaping makes it delimiter-injection-safe; `null` stays
  distinct from `""`); `prevHash` links to the previous entry (null only at genesis).
  `verifyPlatformAuditChain` (pure) recomputes the chain and reports the first broken index — **edits,
  reordering, and internal/prefix deletions** fail verification. (Uses `node:crypto` server-side; the
  platform log is never needed in the browser, unlike the gdpr chain's isomorphic `@noble/hashes`.)
  **Known limit:** truncating the *newest* entries leaves a valid prefix — like any backward hash
  chain, that is undetectable without an external, independently-stored head anchor (out of scope for
  v1; a DB-write attacker who can delete rows could also rewrite an in-collection counter).
- **Order is anchored by a monotonic `seq`, not the clock.** Both head selection (append) and `list`
  ordering use a server-assigned, unique-indexed `seq` (genesis 0, `head.seq + 1`). Reconstructing
  order from `ts`/`_id` is unsafe — ObjectId prefixes aren't monotonic across API replicas and wall
  clocks step backwards — which would falsely flag a valid chain as tampered AND deterministically
  wedge appends. `seq` increases with insertion regardless of process/clock, so head = max(`seq`) is
  always the true tail.
- **Forks are impossible by construction.** Unique indexes on **`seq`** and **`prevHash`** mean at
  most one genesis and no two entries chaining off the same predecessor. A concurrent append that
  loses the race gets a duplicate-key error and **re-reads the (now-advanced) head and retries**
  (bounded), so the chain stays strictly linear without a global lock.
- **Every platform read is recorded** before returning: `tenant.list` / `tenant.read` /
  `tenant.usage.read`, with the actor's user id, target slug (or `*`), and source IP. Recording runs
  in the platform scope (the log is tenant-global, so no tenant context is needed).
- **`GET /platform/audit`** returns the whole chain (gated on `auditLog:list`). Reading the audit log
  is itself **not** audited — it would grow the chain on every inspection with no added signal.

## Consequences

- Cross-tenant access now leaves a tamper-evident trail, satisfying the v1 "audit log" requirement and
  the privacy-by-design posture (invariant 6) for the most privileged plane.
- An auditor can pull `GET /platform/audit` and run `verifyPlatformAuditChain` to detect any
  retroactive tampering of the operator's oversight history.
- Append adds one indexed read (head) + one insert per platform read; fine for the low volume of a
  super-admin plane. Under genuine concurrency the unique-prevHash retry keeps the chain linear.

## Alternatives considered

- **Reuse the gdpr per-tenant chain with a sentinel `tenantId`**: rejected — it overloads tenant
  semantics, and the gdpr port has no db implementation; a dedicated global log is cleaner and doesn't
  pre-empt how the per-tenant audit log will be persisted later.
- **No hash chain (plain append rows)**: rejected — for the most privileged plane, tamper-evidence is
  worth the small cost; it matches the established ADR-0007 posture.
- **Fire-and-forget audit (don't block the read)**: rejected for v1 — audit-then-return guarantees the
  trail exists; a failed append surfaces loudly rather than silently losing oversight history.
