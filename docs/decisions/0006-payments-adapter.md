# 0006 — Payments: Mandate/Charge abstraction, webhook-driven, manual default

**Status:** Accepted · 2026-06-06

## Context

Invariant 9: payments are webhook-driven; never trust the client for payment state; recurring
rails (Autogiro, cards, Swish recurring, Vipps MobilePay) sit behind the payment adapter.
`docs/scope.md` §5/§7 stress that the abstraction must hide the differences between cards/SEPA,
Autogiro mandates (BankID-signed), Swish, and Vipps. Which PSPs to contract is human-owned. A
self-hosting cash-only club must still be able to run billing with **no PSP at all**.

## Decision

**One `Mandate` + `Charge` abstraction** behind `PaymentsPort` (in `adapter-contracts`, no
vendor types leak through):

- A **`Mandate`** is a durable authorization to charge a payer repeatedly (Stripe SEPA/saved
  card, Autogiro *medgivande* via BankID, Swish recurring agreement, Vipps agreement).
  `setupMandate()` returns the mandate (maybe `pending`) plus a provider-agnostic
  **`PaymentAction`** the client completes: `redirect` | `app_switch` (Swish/Vipps) |
  `bankid_sign` (Autogiro) | `sca_3ds`. `createCharge({mandateId})` debits it. The billing
  engine calls these identically for all rails — the rail differs only in `method` + action.
- **State transitions arrive ONLY via webhooks:** verify signature on the **raw bytes** →
  dedupe on `(providerId, connectedAccountId, providerEventId)` → persist raw event → normalize
  to a canonical `PaymentEvent` union → enqueue an idempotent BullMQ apply-job. Client
  success-redirects only trigger a server re-fetch, never set state. `amountMinor` integers
  avoid float money bugs; `idempotencyKey` required on every charge.
- **Webhook→tenant binding:** the connected-account id in the event selects the tenant *and*
  its signing secret *before* the apply-job opens `runInTenantContext` — so a tenant's own PSP
  account cannot mutate another tenant's invoices.

**Default = `manual` (self-host):** a `ManualPaymentProvider` for cash / bank transfer where
staff "mark invoice paid", emitting the **same** canonical `charge.succeeded` event as a
webhook — so the invoice/dunning lifecycle completes with no PSP. `stub` is the sandbox for
development. Real rails (`stripe`, `swish`, `autogiro`, `vipps-mobilepay`) are wired behind the
same port; vendor SDKs are **optional dependencies, dynamically imported** inside their adapter
only, and a CI test asserts none load under `manual`/`none`/`disabled`.

## Consequences

- Payments are the one port with **no self-hostable real-money default by nature** — real
  charges require contracting a PSP. The honest self-host default is cash/manual, which is fully
  functional. This is an inherent property of payments, not lock-in.
- A `connect-payouts` capability extension covers Stripe Connect for the hosted plane (routing
  each dojo's member payments to its own account).

## Alternatives considered

Per-rail interfaces (`StripeService`, `SwishService`): leaks vendors into the engine. A
card-centric `chargeCard()`: can't express Autogiro's offline mandate signing or wallet
agreements. Trusting client success redirects: classic payment-state vuln. All rejected.
