# 0011 — Core membership / CRM / billing data model

**Status:** Accepted · 2026-06-06

## Context

`docs/scope.md` §7 names the non-obvious data-model problems where most design effort goes:
the payer↔student (household) relationship, the Membership-vs-Invoice-vs-Payment distinction,
and the attendance↔promotion link. Getting these shapes right early matters; retrofitting is
costly. This ADR fixes the Phase-1 core entities. (The rank model is ADR-0005; tenancy/identity
is ADR-0004.)

## Decision

Canonical entity shapes live in `@obikai/domain` (pure types + Zod); `@obikai/db` maps them to
Mongoose schemas via the `tenantGuard`. All are tenant-scoped (carry `tenantId`) EXCEPT the
tenant-global `User`/`Identity` (ADR-0004).

- **Member** — a person enrolled at a dojo (the student/customer record): profile, contact,
  emergency contact, status (`lead | trial | active | frozen | cancelled`), `joinDate`,
  optional `userId` (link to a tenant-global login; a child may have none, or their own login
  under a parent's billing), `householdId`, `dateOfBirth` (drives youth/adult + age guards).
  Per-tenant unique soft key on email when present (`{tenantId, emailLower}`).
- **Household** — the billing/family unit: one **payer** (`payerMemberId` or `payerUserId`) and
  many member students. Charges roll up to the household. Models the explicit payer–student
  relationship §7 calls out; a guardian relationship for minors is the `Guardianship` edge
  (ADR-0004), kept SEPARATE from billing (a payer need not be a legal guardian, and vice versa).
- **Plan** — a recurring/one-off **template**: type (`recurring | term | class_pack | drop_in |
  family`), price (`Money`, integer minor units), interval, VAT rate ref. Not a per-member thing.
- **Enrollment** (a.k.a. subscription) — **this member on this plan**, with lifecycle
  (`active | frozen | cancelled`), start/freeze windows, proration anchors. The mutable
  relationship; distinct from the Plan template and from generated Invoices.
- **Invoice** — a generated bill: **per-tenant sequential, gapless number** (via a per-tenant
  counter doc with `findOneAndUpdate $inc` inside the billing transaction — ADR-0004), line
  items with VAT breakdown, seller VAT id, status. Legally retained (ADR-0007 `retain`).
- **Payment / PaymentAttempt** — attempts (incl. dunning retries) against an invoice, driven by
  the payments adapter's webhook events (ADR-0006); never trusted from the client.

Key separations (the §7 traps): **Plan ≠ Enrollment ≠ Invoice ≠ PaymentAttempt**; **Household
billing ≠ Guardianship**; **attendance is queryable as "classes since last promotion in
discipline X"** (the Attendance schema indexes `{tenantId, memberId, disciplineId, occurredAt}`
so the rank engine's input snapshot is a cheap range count — the engine itself stays pure,
ADR-0005).

This ADR ships the **Member + Household** entities and their persistence first (the CRM
table-stakes everything else references); Plan/Enrollment/Invoice/Payment land with the billing
slice against these shapes.

## Consequences

- Money is always integer minor units in the tenant currency (`@obikai/domain` `Money`).
- Erasure (ADR-0007): Member contact PII is `hard_delete`/`anonymize`; Invoices `retain`
  (person anonymized); promotion history pseudonymized-by-reference.
- A member can exist without a login (kids), with their own login, or share a household payer —
  all expressible without schema changes.

## Alternatives considered

Conflating Plan and Enrollment (can't freeze/prorate one member without touching the template);
folding the payer into the Member (can't model one payer↔many students or a child with their own
login); deriving invoice numbers from Mongo `_id`/timestamps (not gapless/sequential — fails EU
invoicing). All rejected per §7.
