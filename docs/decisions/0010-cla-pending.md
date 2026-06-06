# 0010 — Contribution agreement (CLA vs no-CLA)

**Status:** **Pending — human-owned.** Do not decide unilaterally.

## Context

`docs/scope.md` §2 and `CLAUDE.md` list this as a human-owned strategic fork that must be
settled **before the first external contribution is accepted**:

- **(a) Pure community AGPL, no CLA** — copyright becomes shared; the project is permanently
  AGPL and **cannot be unilaterally relicensed**. Maximal goodwill. We would still use a **DCO**
  (`Signed-off-by:`) to prove provenance.
- **(b) AGPL + CLA** — contributors grant relicensing rights, keeping a future **commercial /
  dual-license** option open. Adds contributor friction.

A lighter **DCO** proves provenance but does **not** grant relicensing rights.

## Decision

**Deferred.** Pending the owner's choice. Until then:

- External PRs (including community rank-system templates and UI translations) **cannot be
  merged** — flagged in `CONTRIBUTING.md` and the PR template.
- `CONTRIBUTING.md` documents **both** paths so the project can switch on a single decision with
  no rework.

## Consequences

- Internal/first-party work proceeds unblocked.
- When decided, this ADR is superseded by an `Accepted` ADR recording the choice, and the
  CONTRIBUTING gate is lifted.

## Related human-owned decisions (tracked, not decided here)

Product name is **decided: Obikai** (trademark registration still pending). Payment PSPs to
contract, and hosting provider / EU region, remain human-owned — adapters use sandbox/stubs and
we recommend EU-sovereign hosting (Hetzner/UpCloud/Elastx) without committing.
