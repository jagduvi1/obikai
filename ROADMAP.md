# Roadmap

Obikai is built **foundation-first**, sequenced by dependency and risk rather than deadlines
(see [docs/scope.md](docs/scope.md) §9). This is a living document; status reflects `main`.

Legend: ✅ done · 🔄 in progress · ⏳ planned

## Phase 0 — Foundations ✅
TypeScript monorepo, pluggable adapter seams (payments/email/SMS/storage/auth/AI) with
self-hostable defaults, the pure deterministic rank engine, multi-tenant isolation + auth/RBAC,
i18n + GDPR primitives, Docker/compose, CI with an AGPL license gate. ([ADRs](docs/decisions/))

## Phase 1 — Dojo core 🔄
- ✅ Members + family/households
- ✅ Authentication, sessions, RBAC
- ✅ Memberships & billing: plans, enrollments, invoices with **gapless per-tenant numbering** +
  EU VAT + reverse charge (pure, property-tested money math)
- ✅ Classes & scheduling (weekly RRULE, occurrences, bookings + waitlist)
- ✅ Attendance & check-in (feeds the rank engine)
- ✅ Digital waivers (versioned, minor/guardian)
- ✅ Locations (multi-location)
- ✅ Transactional email (i18n templates over SMTP)
- 🔄 Dunning + recurring billing **as worker jobs**; invoice PDF; VIES VAT-ID validation
- ⏳ Real Nordic payment rails (Autogiro/Swish/Vipps) — adapters scaffolded; PSP contracts are a
  business decision; the self-host default is cash/manual

## Phase 2 — Martial-arts heart ⏳
Grading/testing events, per-rank curriculum, promotion history + certificates, the eligibility
"ready / close / not-yet" dashboard, and the member-facing **"my progress"** view. (The rank
*engine* already exists from Phase 0; these are the features on top.)

## Phase 3 — Engagement & polish ⏳
Branded mobile app + push, competition records, lineage/affiliation, attendance-linked nudges,
churn detection + automations, owner analytics, Nordic wallets, dojo pro-shop, announcement feed.

## Phase 4 — Scale & ecosystem ⏳
Advanced reporting, marketing automation, public API + webhooks, hardened self-host docs + Helm
chart, additional regions/rails, optional AI assists.

## Cross-cutting (continuous)
WCAG 2.1 AA + automated a11y e2e, rigorous tests for the rank engine & billing, security reviews,
i18n coverage (sv/nb/da/fi/en), and self-host/admin/API/contributor docs.
