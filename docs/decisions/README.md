# Architecture Decision Records

Lightweight ADRs for consequential architecture choices and any deviations from
[`docs/scope.md`](../scope.md). Format is a trimmed [MADR](https://adr.github.io/madr/):
**Context → Decision → Consequences → Alternatives considered → Status**.

These are immutable once `Accepted`; to change one, add a new ADR that supersedes it (note the
supersession in both). Keep them short; put detail in code and `docs/`.

| ADR | Title | Status |
|----:|-------|--------|
| [0001](0001-stack-and-tooling.md) | Stack & tooling (pnpm, Turbo, NestJS, Mongoose, Zod, Biome, Vitest) | Accepted |
| [0002](0002-deploy-model-two-axis.md) | Two-axis deploy model (`deployMode` × `tenancy`) | Accepted |
| [0003](0003-monorepo-and-boundaries.md) | Monorepo layout & enforced import boundaries | Accepted |
| [0004](0004-tenancy-auth-rbac.md) | Multi-tenant isolation, auth & RBAC, tenant-global identity | Accepted |
| [0005](0005-rank-engine-and-ai-exclusion.md) | Pure rank engine, versioning & structural AI exclusion | Accepted |
| [0006](0006-payments-adapter.md) | Payments: Mandate/Charge abstraction, webhook-driven, manual default | Accepted |
| [0007](0007-gdpr-erasure.md) | GDPR erasure: pseudonymize-by-reference + per-subject crypto-shred | Accepted |
| [0008](0008-license-posture.md) | AGPL license posture & CI gate | Accepted |
| [0009](0009-config-and-secrets.md) | Config & secrets via validated env | Accepted |
| [0010](0010-cla-pending.md) | Contribution agreement (CLA vs no-CLA) | **Pending (human-owned)** |
| [0011](0011-membership-data-model.md) | Core membership/CRM/billing data model | Accepted |
| [0012](0012-auth-and-sessions.md) | Authentication & session model | Accepted |
| [0013](0013-billing-vat-invoicing.md) | Billing, EU VAT & invoicing | Accepted |
| [0014](0014-scheduling-attendance-waivers.md) | Classes/scheduling, attendance & waivers | Accepted |
| [0015](0015-rank-discipline-data-model.md) | Rank/discipline data model & promotion history | Accepted |
| [0016](0016-frontend-stack.md) | Frontend stack (web-admin / web-member) | Accepted |
| [0017](0017-tenant-registry-and-scheduler.md) | Tenant registry & recurring-billing scheduler | Accepted |
| [0018](0018-seller-billing-profile.md) | Seller billing/legal profile (tenant settings) | Accepted |
| [0019](0019-storage-adapter-wiring.md) | Storage adapter wiring & guarded `/files` route | Accepted |
| [0020](0020-waiver-document-storage.md) | Waiver signed-document storage | Accepted |
