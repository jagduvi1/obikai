# 0025 — VAT-number validation (format + VIES)

**Status:** Accepted · 2026-06-07

## Context

EU B2B invoicing needs the buyer/seller VAT number to be trustworthy: intra-EU reverse charge (Art.
196) and intra-Community supply (Art. 138) only apply when the counterparty is a VAT-registered
business in another member state — and for goods a VIES-confirmed number is now a *substantive*
condition, not a formality. The invoice model already carries `sellerVatId`/`buyerVatId` +
`reverseCharge` (ADR-0013); this adds validation. Two independent concerns: is the number
*well-formed* (offline, cheap) and is it *actually registered* (authoritative, online via EU VIES).

## Decision

- **Offline format validation in `@obikai/domain` (`validateVatFormat`).** Pure + isomorphic: the 27
  EU member-state patterns (prefix + per-country number regex), normalization (strip separators,
  uppercase), and the gotchas — Greece is **`EL`** not `GR`; GB/NO/CH/IS are NOT VIES. Always
  available, no network. It reports *well-formed*, never *registered*.
- **Existence validation behind a pluggable `VatValidationPort`** (adapter-contracts, a 7th adapter
  kind `vat`), feature-flagged by `VAT_VALIDATION_PROVIDER` (ADR-0009): `none` (default — offline,
  always reports `unavailable`, so the product is fully functional with it off) or `vies` (EU REST
  service; `VIES_BASE_URL` overridable). Both are dependency-free (`fetch`), so no dynamic import.
- **THREE-state result — the crucial correctness property.** VIES returns HTTP 200 even when it
  cannot answer, so the adapter maps: `valid:true` → **valid**; `valid:false` with
  `userError ∈ {INVALID, INVALID_INPUT}` → **invalid**; everything else (`MS_UNAVAILABLE`, `TIMEOUT`,
  rate-limit/`*_MAX_CONCURRENT_REQ`, `VAT_BLOCKED`/`IP_BLOCKED`, non-200, network error, unknown) →
  **unavailable**. `unavailable` is NEVER treated as `invalid` — a VIES outage must not block billing
  or wrongly deny reverse charge. `name`/`address` are normalized (`'---'`/`''` → null), since several
  member states (e.g. DE) return blanks even when valid.
- **API**: `POST /billing/vat/validate { vatId }` runs format-first; only if well-formed does it call
  the port (no pointless VIES hit on garbage). Gated on `can('tenantSettings', 'read')` (owner/staff
  do billing setup).

## Consequences

- Operators get immediate offline feedback on any VAT id, and — when VIES is enabled — an
  authoritative registration check whose transient failures degrade gracefully to "unverified".
- Self-host/offline works out of the box (`none`); turning on `vies` is one env var.
- The port is the seam for future national validators (e.g. Norway's Brønnøysund, since NO is not in
  VIES) without touching callers.

## Alternatives considered

- **Treat `valid:false` as invalid regardless of `userError`**: rejected — it conflates a member-state
  outage (routine for VIES) with a genuinely unregistered number, which would wrongly deny reverse
  charge and could make the seller liable. The three-state mapping is the whole point.
- **Checksum validation in the format layer** (Luhn/MOD-11/…): deferred — every country has a
  check-digit algorithm, but a checksum-valid number can still be unregistered, so VIES is the real
  gate; format + VIES is sufficient for v1. Checksums can be added later without API changes.
- **Block invoicing until VIES confirms**: rejected — VIES is too flaky; we surface status and let the
  human decide (invariant 4 posture), recording the check is a follow-up.
