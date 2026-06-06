# CLAUDE.md

Persistent project context for Claude Code. This is a behavioral contract: the **non-negotiables below are invariants** — keep them true even while you improve everything else.

**Before planning anything, read `docs/scope.md` in full** (the complete product + technical spec). The rank engine design is §12 and the AI design is §13. Re-read the relevant section before working in that area.

---

## What we're building

**[PROJECT_NAME]** (working title — rename) is a **dojo-native, open-source SaaS** for martial arts schools. It runs as a multi-tenant hosted service **and** can be self-hosted by a single dojo from the same codebase. The product is built around the **martial-arts journey** — a configurable rank/grading engine, curriculum, attendance-linked promotions, competition, and dojo community. Membership, billing, and scheduling are the administrative backbone, not the point. Target market: **Nordics / EU first**.

This is **not** a gym/fitness app. No workout logging, body-composition tracking, or fitness-class framing.

---

## Non-negotiable principles (invariants)

1. **License: AGPLv3.** Keep every dependency's license compatible (permissive — MIT/ISC/BSD/Apache-2.0 — is fine; no AGPL-incompatible or proprietary code bundled). Add a license check to CI.
2. **One codebase, two deployment modes:** multi-tenant hosted SaaS + single-tenant self-host, selected by config. Don't fork them.
3. **No vendor lock-in — pluggable adapters with self-hostable defaults.** Payments, email, SMS, file storage, auth, and AI all sit behind provider interfaces. Defaults a self-hoster can run: **SMTP** (email), **S3-compatible / MinIO** (storage), **self-hostable auth** (OIDC optional, never required). Never hardcode a specific SaaS vendor.
4. **AI is optional and never authoritative.** The product is fully functional with AI disabled. AI helps *author* config/content and *assist* people; it is **never** in the rank-decision path and **never** auto-promotes. Human-in-the-loop for anything affecting a student's rank. AI provider is a pluggable adapter (Anthropic/OpenAI/local-via-Ollama/none).
5. **Rank engine = declarative config + deterministic evaluator.** Admins define disciplines/ranks/criteria/curriculum as data; a plain, testable engine evaluates eligibility and promotions. **"Belt" is a presentation type, not a core assumption** (must also handle kyu/dan, levels/tiers, and belt-less arts). Rank systems are **versioned**; promotion history is **immutable** and references the version it was granted under.
6. **EU-first compliance is core, not later:**
   - **GDPR**: data export, right-to-erasure, consent records, audit log, documented controller/processor split. Privacy by design.
   - **EU data residency** for the hosted service.
   - **i18n from day one**: sv, nb, da, fi, en. Translatable rank/curriculum content. Locale-aware dates/numbers/currency (SEK/NOK/DKK/EUR).
   - **Accessibility**: WCAG 2.1 AA (EAA / EN 301 549) — an acceptance criterion for member-facing UI, not an afterthought.
   - **EU VAT**: configurable rates, B2B reverse charge, compliant sequentially-numbered invoices.
7. **Quality over speed.** Time is not the constraint. Strong automated tests (the **rank engine** and **billing** get rigorous coverage), security, and docs. Build foundation-first (scope §9); don't take shortcuts to "ship."
8. **TypeScript end-to-end.**
9. **Payments are webhook-driven; never trust the client for payment state.** Recurring rails matter (Sweden: Autogiro + cards; Swish recurring is growing; Nordic wallet: Vipps MobilePay) — keep them behind the payment adapter.
10. **Keep the self-host footprint small.** Target runtime: app + MongoDB + Redis (+ the operator's own SMTP/S3). Don't add a *mandatory* external service without strong justification.

---

## You have free hands (decide and keep moving)

You are expected to make engineering decisions and improve on the plan. Within the invariants above, you own:
- Concrete stack/library/framework choices (e.g. Express vs NestJS, ODM, component library, auth library, job queue, test tooling). Pick the best fit; record *why* in the decisions log.
- Data models, API design, monorepo/folder structure, module boundaries.
- UX and visual design for excellent usability (within the a11y + i18n constraints).
- The adapter interface shapes and which built-in rank templates to seed.
- **If you find a better approach than the scope doc, take it** — note the deviation and rationale in the decisions log.

Bias to action. Surface only genuinely consequential forks; otherwise decide, document, and proceed.

---

## Human-owned decisions (do NOT decide these alone — ask)

- **CLA vs no-CLA** for contributions (affects future relicensing / a commercial-license option). *Status: undecided.* Flag before accepting any external contribution.
- **Product name, branding, trademark.**
- **Which payment PSPs to contract** (Swish / Autogiro / Vipps MobilePay providers — cost + contracts). Build the adapter and use sandbox/stubs until chosen; recommend options.
- **Hosting provider / EU region** for the managed service. Recommend; don't commit.

---

## How we work

- **Foundation-first.** Follow the build order in scope §9. Start at Phase 0.
- **Tests alongside code**; CI must stay green. Rank-engine and billing logic need edge-case/property tests.
- **Conventional commits**, small reviewable changes, keep `CHANGELOG.md` current.
- **Docs are part of the product:** user, admin, **self-host**, API, and contributor docs stay up to date.
- **Decisions log:** maintain `docs/decisions/` (lightweight ADRs) for consequential architecture choices and any deviations from the scope.
- **Secrets/config via env**; no secrets in the repo; feature flags for optional integrations.
- Keep `CLAUDE.md` accurate as decisions land — but keep it short. Put detail in `docs/`.

---

## Where to start (first task)

**Phase 0 — Foundations.** Before writing feature code, **propose a short architecture plan for review**, then build:
- TypeScript monorepo layout + tooling + CI/CD.
- Docker + docker-compose for one-command local/self-host bring-up.
- The **pluggable adapter interfaces** (payments / email / SMS / storage / auth / AI) with self-hostable defaults stubbed in.
- Multi-tenant scaffolding + auth + RBAC (roles: owner, instructor, staff, member, guardian).
- i18n scaffolding and GDPR primitives (export / erasure / consent / audit).
- Test harness.

Get the skeleton and the adapter seams right first — features come after.
