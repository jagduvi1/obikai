# 0013 — Billing, EU VAT & invoicing

**Status:** Accepted · 2026-06-06

## Context

Phase 1 needs recurring dues with autopay, dunning, freezes/proration, and **EU-compliant
invoices** (configurable VAT, B2B reverse charge, sequentially-numbered) — scope §4.2, §5, §7,
§11. Billing is a silent-bug-cost area, so the money math is pure and property-tested. Payments
ride the webhook-driven adapter (ADR-0006); this ADR covers the billing model on top.

## Decision

- **Model (ADR-0011 separations):** `Plan` (template) → `Enrollment` (this member on this plan,
  with freeze/cancel/period state) → `Invoice` (a generated bill) → `PaymentAttempt` (incl.
  dunning retries). Money is always integer minor units (`@obikai/domain` `Money`).
- **Pure money helpers in `@obikai/domain/billing`** (property-tested): `computeVat` (round half
  away from zero), `buildInvoiceLine` / `invoiceTotals`, `prorateByDays` (conservation:
  `prorate(x,n,k)+prorate(x,n,n−k)=x` ±1 minor unit). Keeping these pure makes proration/VAT
  reproducible and testable without a DB.
- **Gapless, sequential invoice numbers per tenant** — required for EU invoicing. Allocated from a
  **per-tenant counter document** via `findOneAndUpdate($inc)` inside the issue transaction, and
  assigned **only when an invoice is issued** (drafts have `number: null`). Never derived from
  `_id`/timestamps. Format `{prefix}{year}-{seq}` (configurable).
- **VAT:** per-tenant `VatRate`s (configurable %, e.g. SEK 25/12/6/0). Invoices carry the seller
  VAT id and a per-line VAT breakdown. **Reverse charge** (intra-EU B2B): `reverseCharge=true`
  zeroes line VAT and prints the legally-required note; VIES validation of the buyer VAT id is a
  later enhancement (flagged).
- **Dunning** is worker-driven (BullMQ, ADR-0001): a `dunning` job walks overdue invoices through a
  configurable ladder (retry mandate charge → reminders → grace → suspend enrollment), advancing
  `Invoice.dunningStage` / `nextRetryAt`. Payment state only ever changes via the adapter's
  signature-verified webhooks (ADR-0006), never the client.
- **Recurring rails** (cards/SEPA via Stripe, **Autogiro** BankID mandate, Swish, Vipps) sit behind
  the `PaymentsPort` `Mandate`/`Charge` abstraction (ADR-0006); `Enrollment.mandateRef` links the
  authorization. Default `manual` provider lets a cash/bank-transfer dojo run billing with no PSP.

## Consequences

- Invoices are legally retained (ADR-0007 `retain`); erasure anonymizes the linked person.
- Per-tenant unique index on the invoice counter + `{tenantId, number}` guarantees gapless
  uniqueness under concurrency (property/integration tested).
- Proration/VAT correctness is covered by `@obikai/domain` property tests independent of the DB.

## Alternatives considered

Floating-point money (drift); invoice numbers from `_id`/time (not gapless/sequential — fails EU
rules); synchronous in-request dunning (provider retries cause duplicates — async + idempotent is
safer). All rejected.
