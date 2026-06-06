# 0018 — Seller billing/legal profile (tenant settings)

**Status:** Accepted · 2026-06-06

## Context

EU-compliant invoices (ADR-0013) must show the **seller's** legal identity: legal name, VAT
registration number, organisation/registration number, and registered address. The invoice model
already carries a `sellerVatId` snapshot field, but nothing in the system *stored* those seller
details — `Tenant` (ADR-0017) is the tenant-global registry and intentionally holds only
slug/name/status, and config is env-only (ADR-0009), which is wrong for per-tenant, owner-editable
business data. This was a hard blocker for invoice PDF generation and for VIES VAT validation, so it
is built first.

## Decision

- **A new tenant-OWNED `TenantBillingProfile`** (`@obikai/domain`): `legalName` (required) plus
  nullable `vatId`, `registrationNumber`, address (`addressLine1/2`, `postalCode`, `city`,
  `country` as ISO 3166-1 alpha-2), `email`, free-text `paymentDetails` (IBAN/Bankgiro/Swish for
  manual-payment invoices) and `footerNote`. Validated by `billingProfileInputSchema`.
- **It is guarded tenant data, not the registry.** Unlike `Tenant` (tenant-global, exempt from
  `tenantGuard`), the billing profile is owned by one tenant and so IS guarded (ADR-0004) — asserted
  in `test/billing-profile.test.ts` (the schema HAS a `tenantId` path; reads/writes require a tenant
  context and never leak across tenants).
- **Singleton per tenant.** Enforced by a compound unique index `{tenantId, singleton}` on a constant
  `singleton:'profile'` discriminator — chosen over a `{tenantId}` unique index because the guard
  already declares a `tenantId` index, and a second same-key index collides on the auto-generated
  name (and warns at model load). Access is a context-scoped `findOne({})` / `findOneAndUpdate({})`
  upsert (PUT semantics: omitted fields clear to null).
- **HTTP**: `GET /settings/billing-profile` (→ profile | null) and `PUT /settings/billing-profile`,
  authorized via the existing `tenantSettings` RBAC resource — **owner** edits (has all actions),
  **staff** may `read` it (they issue invoices that print these details); members cannot.
- **web-admin Settings page** pre-fills from the saved profile and PUTs the whole profile. Added a
  `put` verb to the shared `@obikai/api-client`.

## Consequences

- Invoice PDF (next PR) and VIES validation now have a source of truth for seller identity; the PDF
  renderer reads this profile for the seller block and `footerNote`/`paymentDetails`.
- Seller VAT details remain snapshotted onto each invoice at issue time (ADR-0013) — editing the
  profile later never rewrites historical invoices.
- This is the first **tenant settings** surface; future per-tenant configuration (invoice number
  prefix, default due-days, locale defaults) can extend this entity or sit beside it under
  `/settings/*` with the same `tenantSettings` RBAC.

## Alternatives considered

- **Put seller details on the tenant-global `Tenant`**: rejected — that entity is the cross-tenant
  registry (queried under `runAsPlatform`); business/tax data belongs to tenant-scoped, guarded
  storage so it can never be read cross-tenant.
- **Env-only configuration** (ADR-0009 style): rejected — these are owner-editable per tenant and
  differ per dojo on the hosted plane; env is for deploy/secret config, not business data.
- **`{tenantId}` unique index for the singleton**: rejected — collides with the guard's `tenantId`
  index (same key, same auto-name) and warns at every model load; the compound index with a constant
  discriminator is clean and idiomatic (mirrors other compound unique indexes like membership).
