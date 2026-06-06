# Martial Arts Dojo App — Product & Technical Scope

A build-ready plan for a **dojo-native, open-source SaaS** for martial arts schools. The product is built around the martial-arts journey (ranks, grading, community), runs as a hosted multi-tenant service *and* can be self-hosted, is licensed AGPLv3 so it can't be taken closed, and targets the Nordics/EU first. No code here — this is the "what" and "why" to plan the build from.

---

## 0. Project posture (read first)

These four commitments shape every decision below:

- **Quality over speed.** Time and effort are not the constraint — correctness, clean architecture, strong testing, accessibility, and documentation are. The phasing in §9 is about *dependency order and risk*, not deadlines. Avoid "ship-fast MVP" compromises.
- **Open-source SaaS.** One AGPLv3 codebase that you operate as a hosted multi-tenant service, and that anyone can self-host. The hosted version is the convenient, managed option; it is not a different product.
- **EU / Nordic first.** GDPR, EU data residency, Nordic payment rails, and multilingual support are core requirements, not add-ons. Other regions are a later scope.
- **Dojo-native.** Built around martial-arts progression and dojo culture — not a generic gym/fitness tool with belts bolted on. No workout logging, no body-composition tracking, no fitness-class marketplace framing.

---

## 1. What this product is

This is **dojo management software**. Membership dues, scheduling, and attendance are present, but only as the administrative backbone every school needs — they are plumbing, not the point. The product's spine is **martial-arts progression and dojo community**: belt/rank tracking, stripes, grading and promotions, curriculum, multi-discipline tracking, competition history, lineage, and the school's culture.

Most established players (Zen Planner, Gymdesk, Kicksite, Wodify, PushPress) grew out of *fitness* software and treat martial arts as a module. Your wedge is the opposite — martial-arts-native from the ground up, open-source, and EU-first. "Best app" is won on that depth plus member engagement, not on having yet another billing screen.

---

## 2. Licensing & open-source strategy

### Why AGPLv3 is exactly right for your goal
Plain GPL's share-back obligation triggers on **distribution** of the software. A SaaS never distributes the binary — users access it over the network — so under GPL a competitor could take the code, modify it, run it as a closed hosted service, and never publish their changes (the "SaaS loophole"). **AGPLv3 §13 closes this**: anyone who runs a modified version and lets users interact with it over a network must offer those users the corresponding source. That's precisely your requirement — nobody can take it, polish it, and sell it closed.

### Implications and tradeoffs
- Anyone running a modified version as a service (including you) must publish the corresponding source. For your own SaaS that's fine — it's your open code.
- Some enterprises forbid AGPL software internally (Google is the well-known example). For a dojo app this rarely matters, but be aware it can narrow certain corporate adoption.
- **Dependency license hygiene.** AGPL can incorporate permissive dependencies (MIT, ISC, BSD, Apache-2.0) — and most of the JS/Node ecosystem is permissive, so this is usually a non-issue. Avoid bundling code under AGPL-incompatible or proprietary licenses. Run an automated license checker in CI so a bad dependency can't slip in.

### The one strategic fork to decide now: CLA or not
- If you accept outside contributions under AGPL **with no agreement**, the copyright becomes shared and you **cannot unilaterally relicense** later.
- If you want to keep the option to sell **commercial licenses** (dual-licensing — a common AGPL monetization for customers who can't accept AGPL terms) or otherwise relicense, require a **Contributor License Agreement (CLA)** that grants you those rights.
- A lighter **DCO** (Developer Certificate of Origin) proves provenance but does **not** grant relicensing rights.
- Tradeoff: a CLA adds contributor friction and some community pushback; no-CLA maximizes goodwill but locks you into AGPL forever. Decide between **(a) pure community AGPL, no CLA** or **(b) AGPL + CLA, commercial door open** — this is purely a business choice, but make it before accepting the first external PR.

### Trademark
AGPL covers the *code*, not the *name and logo*. Trademark the product name so forks must rebrand and can't pass themselves off as the official project (the Mozilla/Firefox and WordPress model).

### Monetization consistent with "fully open"
Since you want it fully open (not open-core), the model is: **hosted SaaS subscriptions** (convenience, EU hosting, managed updates, support) + **optional commercial licensing** (only viable if you take the CLA path) + paid support/onboarding. Don't gate features as proprietary unless you later deliberately choose an open-core model.

### Repo & community hygiene (from day one)
LICENSE (AGPL-3.0), clear README, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue/PR templates, CHANGELOG, semantic versioning, a public roadmap, and an in-app "source available" link in the footer (good practice and reinforces the AGPL source offer).

---

## 3. Open-source SaaS architecture & self-hosting

### One codebase, two deployment modes
- **Hosted SaaS:** multi-tenant — many dojos served from one deployment that you operate.
- **Self-host:** typically **single-tenant** (one dojo) for simplicity, from the same image via a config flag. Decide whether self-host should also support multi-tenant (e.g., a federation/association hosting several clubs) or stay single-tenant.

### No vendor lock-in — pluggable adapters (the core principle)
Every external dependency must be swappable so a self-hoster isn't forced into *your* vendors. This is also what makes the Nordic payment story tractable (you'll wire up several rails). Define clean interfaces with adapters for:
- **Payments:** a provider interface with adapters (Stripe for the hosted SaaS; the door open for regional rails and self-hoster choices). Never hardcode Stripe.
- **Email:** **SMTP as the universal, self-hostable baseline**, plus adapters (SES, Postmark, etc.). A self-hoster points it at their own SMTP server.
- **SMS:** pluggable and **optional** (46elks, Twilio…); a dojo can disable SMS entirely.
- **File storage:** an **S3-compatible** interface → works with AWS S3, Cloudflare R2, or self-hosted **MinIO**. Don't hardcode AWS.
- **Auth:** must work **without** any paid SaaS. Build on self-hostable auth (a library you control, or a self-hostable identity server); offer external **OIDC/SSO as optional**, never a hard dependency. (A hosted convenience IdP is fine *if* it's optional.)
- **AI provider (if used):** a provider interface with adapters (Anthropic/Claude, OpenAI, a self-hostable local model via Ollama, or **none**). AI must be optional — the product is fully functional with it disabled. See §13.

### Deployment & ops for self-hosters
- **Docker images + docker-compose** for one-command bring-up; an optional **Helm chart** for Kubernetes.
- **All configuration via env vars / config file**; no hardcoded secrets; feature flags to toggle optional integrations (SMS on/off, which payment rails, etc.).
- Clean, idempotent **database migrations** + optional seed data; documented **backup/restore** and **upgrade** path.
- A **self-hosting guide** is a first-class deliverable — OSS adoption lives or dies on this.
- Any usage **telemetry must be opt-in / disable-able**; the OSS community expects this.

### Keep the required-services footprint small
A self-hoster should be able to run: **app + MongoDB + Redis** (plus their own SMTP and S3-compatible storage). Every additional *mandatory* service hurts self-host adoption. (You could add Postgres for financial-transaction integrity — note the tradeoff in §8 — but keeping the stack lean serves self-hosters.)

---

## 4. Feature modules

Each module lists **Table stakes** (must-have to be credible) and **Differentiators** (what pushes toward "best").

### 4.1 Members & CRM
**Table stakes:** member profiles (contact, emergency contact, photo, join date, status); **family/household accounts** (one payer, multiple students — very common with kids); lead/prospect capture and a **trial-to-member pipeline** (the conversion window is short, ~7–14 days); tags/segments.
**Differentiators:** at-risk/churn detection (flag members whose attendance is dropping before they cancel); automated follow-ups for trials and lapsed members; lead-source and lifetime-value reporting.

### 4.2 Memberships & Billing
**Table stakes:** plan types (recurring monthly, paid-in-full terms, class packs, drop-in, family plans); recurring billing with autopay; **failed-payment recovery (dunning)** with retries + notifications; freezes/holds, upgrades/downgrades, proration, cancellations; invoices, receipts, payment history.
**Differentiators:** Nordic payment rails (see §5); a **dojo pro-shop** (sell gis, belts, patches, gear — dojo-relevant retail, not fitness/supplement merch); revenue analytics (MRR, churn, recovery rate).

### 4.3 Classes & Scheduling
**Table stakes:** program definitions (Adults BJJ, Kids Karate, Open Mat, Fundamentals…); recurring weekly schedule, per-class capacity, instructor assignment; member booking + waitlists; private/1:1 lesson booking; calendar views for staff and members.
**Differentiators:** capacity rules tied to membership type (e.g. fundamentals-only members can't book advanced); auto-cancellation of under-booked classes; substitute-instructor handling.

### 4.4 Attendance & Check-in
**Table stakes:** kiosk/tablet check-in (PIN, QR, or member search) and instructor-marked attendance from a roster; attendance history per member and per class.
**Differentiators:** **attendance feeds promotion eligibility** (classes-since-last-promotion is a core grading input — this is where attendance and belts connect); streaks and milestones ("100 classes"); low-attendance alerts; self check-in via the member app.

### 4.5 Belt & Rank Tracking — the core of the product
Treat this as a first-class module, not an add-on. This is where you win. The feature surface is below; the detailed, admin-configurable **engine design is in §12**, and the **AI assistance that helps admins set it up is in §13**.
**Table stakes:**
- **Configurable rank systems per discipline** — each art (BJJ, Karate, TKD, Judo…) has its own ordered ranks with custom names, colors, and visuals.
- **Sub-ranks / stripes** — model belts *and* the stripe steps within them (e.g. BJJ awards up to four stripes per belt).
- **Separate kids'/youth systems** with their own belts and youth→adult transition rules.
- **Per-rank promotion criteria** combining minimum time-at-rank, minimum classes attended since last promotion, and a manual instructor evaluation/sign-off.
- **Promotion history/timeline** per student (every belt and stripe, date, and who awarded it).
- **Eligibility dashboard** — "who's ready, who's close, who needs more time."
**Differentiators:**
- **Grading/testing events** — schedule a test, auto-invite eligible students, record results, keep testing history.
- **Curriculum/syllabus per rank** — techniques required for the next belt, optionally checked off per student; member-facing "what I need for the next belt."
- **Multi-discipline on one profile** — a student is purple belt in BJJ *and* a separate rank in Muay Thai, tracked independently.
- **Promotion artifacts** — auto-generated certificates, printable rosters, belt labels.
- **Instructor feedback notes** on a student's progression (a known gap in incumbents).
- **Configurable age/eligibility guards** (e.g. encode IBJJF-style "16+ for blue belt" as a rule, not hardcoded).

### 4.6 Member-facing experience (portal + app)
**Table stakes:** self-service profile and membership/payment status; pay/update payment method; download invoices; book/cancel classes; sign waivers digitally.
**Differentiators:** a **"my progress" view** (current belt/stripes, attendance toward next promotion, curriculum checklist) — huge for engagement; a **branded mobile app**; a school announcement/social feed; push notifications ("you're 2 classes from eligibility").

### 4.7 Staff / instructor tools
**Table stakes:** view rosters and mark attendance quickly (mobile-friendly); see a student's rank, history, and notes at a glance; award stripes/promotions (permission-gated).
**Differentiators:** an instructor app optimized for mat-side use (big tap targets, offline-tolerant check-in); per-instructor evaluation and grading sign-off workflows.

### 4.8 Communication & messaging
**Table stakes:** email + SMS to members/segments; automated transactional messages (receipts, failed-payment alerts, class reminders, waiver requests).
**Differentiators:** an automation builder (trial drips, win-back campaigns, anniversary messages); two-way messaging with per-member history.

### 4.9 Reporting & analytics
**Table stakes:** revenue (MRR, collected, outstanding), active members, new vs cancelled, attendance trends.
**Differentiators:** retention/churn cohorts, rank distribution across the school, class/instructor utilization; an **action-oriented owner dashboard** ("5 members at risk", "12 eligible for promotion", "3 failed payments to recover").

### 4.10 Admin, roles & compliance
**Table stakes:** RBAC across owner/instructor/staff/member/guardian; multi-location support (shared members, per-location schedules, consolidated reporting); **digital waivers including minor waivers** signed by a guardian, versioned and timestamped; an audit log of sensitive actions (promotions, refunds, membership changes).
**Differentiators (and table stakes in the EU):** full GDPR tooling — see §5.

### 4.11 Competition, events & dojo culture (martial-arts-native)
No equivalent in fitness software; reinforces the dojo-first identity.
**Table stakes:** seminar/special-event scheduling and sign-up (visiting black belts, guest instructors); open-mat and grading-day events surfaced to members.
**Differentiators:** **competition tracking** (tournaments entered, divisions, results, medals per student — a personal "competition record" in the member app; highly motivational and unique to combat sports); **lineage & affiliation** (instructor lineage and the school's association/governing body — meaningful in arts where lineage carries weight); a dojo announcement feed and culture moments (promotion shout-outs, milestones).

---

## 5. EU & Nordic specifics (primary requirements)

### GDPR (foundational)
Lawful basis + **consent records**, privacy by design/default, data minimization, a clear **retention policy**, **data export** and **right-to-erasure**, a breach process, **DPAs with sub-processors**, and a record of processing (ROPA). Handle emergency/health data with extra care. Document the controller/processor split: for self-hosters the **dojo is the controller**; for your hosted SaaS you are a **processor** for each dojo's member data and a **controller** for the gym-owner accounts.

### Data residency
Host in EU regions. EU-sovereign options include **Hetzner** (DE), **OVHcloud** and **Scaleway** (FR), and Nordic providers like **UpCloud** (FI) and **Elastx** (SE); or EU regions of AWS/GCP/Azure. Self-hosters control their own residency.

### Payment rails (Nordic-first) — why the adapter pattern matters
Recurring dues are the heart of billing, so get the recurring rails right:
- **Sweden — Autogiro** (Bankgirot direct debit, authorized by a **BankID**-signed mandate) is the established membership rail and is commonly used for gym memberships; cards (recurring) are also standard. **Swish** is expected for instant/one-off payments, and **Swish recurring launched in 2024** but bank support is still rolling out — support it, but don't rely on it alone yet.
- **Nordics — Vipps MobilePay** (the 2022 merger) is the regional wallet across Norway, Denmark, Finland, and Sweden, keeping the local brand names (Vipps in NO/SE, MobilePay in DK/FI). One integration path covers the region.
- **Broader EU — cards + SEPA Direct Debit** (recurring) via Stripe; **SCA / 3-D Secure** is mandatory.
- **e-ID** (BankID in Sweden and equivalents) is central for identity and mandate signing in the Nordics.
- Practically you'll integrate several rails (Stripe for cards/SEPA, Swish, Autogiro, Vipps MobilePay), often through PSPs/aggregators — which is exactly why payments must sit behind a provider interface.

### EU VAT
- **Your B2B SaaS** (billing dojo owners): VAT on digital services; intra-EU **B2B reverse charge** with **VIES VAT-ID validation**; VAT for B2C; consider **OSS (One-Stop-Shop)** for cross-border B2C reporting. Stripe Tax can assist.
- **Dojos billing members:** sports/membership fees have country-specific VAT treatment (some EU countries exempt non-profit sports), so the software must support **configurable VAT rates** and produce **compliant, sequentially numbered invoices** with a VAT breakdown and seller VAT ID.

### Localization (i18n / l10n)
- Languages from day one: **Swedish, Norwegian (Bokmål), Danish, Finnish, English**. Translatable belt/rank names and curriculum content. Locale-aware dates, numbers, and currency.
- Currencies: **SEK, NOK, DKK, EUR** (per-tenant).

### Accessibility (EAA)
Your member-facing app/portal is consumer-facing and within scope of the **European Accessibility Act** (in force since **28 June 2025**; technical standard **EN 301 549**, which incorporates **WCAG 2.1 Level AA**). Only microenterprises (under 10 staff and under €2M turnover) have a limited exemption — but build to **WCAG 2.1 AA** from the start: it's the right baseline, becomes mandatory as you scale, and is a genuine "best" differentiator.

---

## 6. What makes it "the best"

Ranked by how much they actually move the needle:
1. **Belt/grading excellence + curriculum.** Be the app that takes progression seriously — rich, flexible, multi-discipline, with member-facing progress. This is your wedge.
2. **Retention engine.** At-risk detection, attendance-linked nudges, milestones, social proof. This is what makes dojos money and keeps them subscribed.
3. **A genuinely good member app.** Most incumbents' member apps are mediocre; a clean, fast app where students see belt progress and book classes is differentiating.
4. **Frictionless billing + dunning + Nordic rails.** Owners switch software over billing pain; native Autogiro/Swish/Vipps MobilePay support is a strong regional advantage.
5. **Open-source trust + self-hostability.** AGPL + self-host appeals to clubs (and associations) wary of lock-in, and builds a community/contributor moat.
6. **EU-first compliance.** GDPR, EU data residency, and WCAG/EAA accessibility where US-built tools are weak.
7. **Smooth onboarding/migration.** Importing existing member + rank data without breaking billing cycles is a real adoption barrier.
8. **(Optional) AI assists.** Churn prediction, promotion suggestions, lead-nurture copy — a light layer, not the foundation.

---

## 7. The hard parts to model

The non-obvious data-model problems where most of the design effort goes (conceptual, not schema):
- **Rank/belt engine** (the trickiest): `Discipline → RankSystem (ordered) → Rank → (stripes/sub-steps) → PromotionRequirements`, plus an immutable per-student `RankProgression` log. Keep promotion *rules* configurable per rank (time-at-rank, classes-required, manual eval, age guard). Separate adult and youth systems. Never hardcode a single art's belts.
- **Membership vs Invoice vs Payment:** distinguish the *plan* (recurring template), the *enrollment/subscription* (this member on this plan, with start/freeze/cancel states), generated *invoices*, and *payment attempts* (including retries). Freezes, proration, and mid-cycle changes are where this gets messy.
- **Family/household billing:** one payer, many students; charges roll up; a child can have their own login under a parent's billing. Model the payer–student relationship explicitly.
- **Attendance ↔ promotion link:** attendance must be queryable as "classes since last promotion in discipline X."
- **Recurring schedules:** use an RRULE/iCal-style recurrence to generate class occurrences; handle one-off cancellations/overrides without rewriting the series.
- **Multi-tenancy isolation** (hosted): pick the isolation strategy up front (shared DB with tenant key vs DB-per-tenant); retrofitting is painful.
- **Payment-provider abstraction:** a clean interface that hides the differences between cards/SEPA, Autogiro mandates, Swish, and Vipps MobilePay, with webhook-driven state.
- **VAT & invoicing model:** configurable rates, reverse-charge logic, sequential invoice numbering, and exemptions.

---

## 8. Technical architecture on MERN

What this specific app demands on top of MERN, given the quality-first posture:
- **Language: TypeScript end-to-end** (not plain JS). For a large, long-lived, contributor-friendly codebase, type safety pays for itself.
- **Multi-tenancy (hosted):** tenant-scoped queries everywhere; chosen isolation strategy; self-host runs single-tenant.
- **Auth & RBAC:** roles for owner/instructor/staff/member/guardian; self-hostable auth; optional OIDC/SSO. For the hosted SaaS, charging gym owners and routing member payments to each dojo's own account typically uses Stripe Connect (behind the payment adapter).
- **Payments:** adapter pattern; **webhook-driven** state (never trust the client for payment status); SCA/3DS; idempotency keys.
- **Background jobs:** a queue/scheduler (**BullMQ + Redis**) for billing runs, dunning retries, reminders, eligibility recomputation, and churn detection. Don't rely on single-server cron.
- **Notifications:** SMTP/email adapter, optional SMS adapter, push (FCM/APNs/Expo).
- **File storage:** S3-compatible (MinIO for self-host) with signed URLs — waivers, certificates, photos, curriculum media. Not in Mongo.
- **Real-time (optional):** websockets (Socket.IO) for kiosk dashboards and live rosters.
- **Mobile:** **React Native (Expo)** for a real branded member app across iOS/Android (reuses your JS/TS skills); PWA as a lighter fallback.
- **Observability:** structured logging, metrics, and error tracking — prefer self-hostable options (e.g. OpenTelemetry; Sentry has a self-host edition) so self-hosters keep parity.
- **Security:** it holds PII + payments — secrets management, dependency + license scanning in CI, rate limiting, audit logs, least privilege, regular updates.
- **Data:** Mongo as primary; **index deliberately** for the heavy queries (eligibility, attendance-since-date, revenue rollups). Know the tradeoff that some teams add Postgres for financial-transaction integrity — but keeping the stack lean helps self-hosters.
- **i18n architecture** baked in from the start.

---

## 9. Build order (foundation-first, not deadline-driven)

Since speed isn't the constraint, sequence by **dependency and risk** — build each layer properly before the next, keeping the system coherent at every step.

**Phase 0 — Foundations.** Repo + AGPL + the CLA decision; TypeScript monorepo; CI/CD; test harness; Docker/compose; auth + RBAC; multi-tenant scaffolding; i18n scaffolding; the **pluggable adapter interfaces** (payments/email/storage/auth); GDPR data-handling primitives (export, erasure, consent, audit). Get the skeleton right.

**Phase 1 — Dojo core.** Members + family accounts; memberships + recurring billing (cards/SEPA + **Autogiro**) + dunning; classes + scheduling; attendance/check-in; digital waivers (incl. minor); member self-service portal; transactional email; EU-compliant invoicing + VAT.

**Phase 2 — Martial-arts heart.** The belt/rank engine (multi-discipline, stripes, kids systems, configurable criteria); eligibility dashboard; grading events; promotion history; curriculum; certificates; the "my progress" view. This is where you go deep.

**Phase 3 — Engagement & polish.** Branded mobile app + push; competition records; lineage/affiliation; attendance-linked nudges; churn detection + automations; action-oriented owner analytics; Nordic wallets (**Swish**, **Vipps MobilePay**); dojo pro-shop; announcement/social feed.

**Phase 4 — Scale & ecosystem.** Multi-location; advanced reporting; marketing automation; public API + webhooks; hardened self-host docs + Helm chart; additional regions and payment rails (next scope); optional AI assists.

---

## 10. Suggested stack (self-host-friendly — a starting point, not gospel)

- **Language:** TypeScript everywhere.
- **Admin frontend:** React + a component library + TanStack Query; i18n (e.g. i18next).
- **Member app:** React Native (Expo), or PWA to start.
- **Backend:** Node + **NestJS** (structure for a large, long-lived codebase) or Express; Mongoose/MongoDB; Redis; BullMQ.
- **Payments:** Stripe (cards/SEPA/SCA, + Connect for the hosted SaaS) behind an adapter; Swish/Autogiro/Vipps MobilePay via PSP adapters.
- **Email:** SMTP + provider adapters. **SMS:** 46elks/Twilio adapter (optional). **Push:** Expo/FCM/APNs.
- **Storage:** S3-compatible (MinIO for self-host).
- **Auth:** self-hostable (a library you control or a self-hostable identity server) + optional OIDC.
- **Infra:** Docker/compose (+ optional Helm), EU hosting, infrastructure-as-code, a self-hostable observability stack.

---

## 11. Quality bar (because the goal is "best")

- **Testing:** a real test pyramid, with the **rank engine** and **billing** (proration, dunning, mandates) covered hard — these are the areas where silent bugs cost the most.
- **Accessibility:** WCAG 2.1 AA (EAA / EN 301 549), tested with real assistive technology — not just automated checks.
- **Security:** security reviews; dependency + license scanning in CI; secrets management; audit logs.
- **Performance:** budgets and multi-tenant load testing for the hosted side.
- **Documentation:** user, admin, **self-host**, API, and contributor docs — these are part of the product, not an afterthought.
- **i18n correctness:** locale formatting and full translation coverage verified, not assumed.

---

## 12. The configurable rank engine (deep design)

The admin of each tenant defines their own discipline(s) and progression — the platform ships no hardcoded art. The engine is **declarative configuration interpreted by a deterministic evaluator**: the admin's definitions are *data*; a plain, predictable engine evaluates eligibility and promotions. AI (§13) only helps *author* that data — it is never in the evaluation path.

### Design principles
- **"Belt" is a presentation type, not a core assumption.** Model abstract *ordered milestones*; make presentation configurable (belt, sash, armband, level, tier, or none). One engine then covers BJJ (belts + stripes), Karate/TKD (kyu counting down, dan counting up, with required forms), Judo, *and* belt-less arts like Muay Thai, boxing, or MMA (levels/tiers, or no ranks at all).
- **A uniform "ladder of typed steps."** Treat full ranks, intermediate markers (stripes/tags), and dan degrees as steps of different *types* within one ordered sequence, so criteria, curriculum, and history attach to every step identically. (Simpler alternative: model stripes as a per-rank attribute; the uniform-ladder model is more general and is the recommended approach.)
- **Versioning + immutable history.** Editing a system creates a new version; each past award keeps referencing the version it was granted under, so changing the belt system later never rewrites a student's record.
- **The engine is deterministic.** Eligibility and promotion are plain rule evaluation — reliable, testable, and fully functional offline/self-hosted. No AI in the critical path; no auto-promotion.

### Core concepts (conceptual, not schema)
- **Discipline** (tenant-scoped): the art, a description, and a *presentation style* (belt / sash / armband / level / tier / none).
- **Progression system** (per discipline): supports variants such as **Adult** and **Kids** (by age band); **versioned**.
- **Step** (the ladder): an ordered, award-able milestone, each with a *type* — full rank, intermediate marker (stripe/tag), dan degree, or level number.
- **Visual spec** (per step): primary/secondary colors, pattern (solid/split/striped), stripe count + color, optional image — enough to render BJJ split kids belts, karate colors, etc.
- **Age bands / tracks:** adult vs youth systems, plus the **transition rule** (which adult step a youth maps into at a given age).
- **Promotion criteria** (per step; composable AND/OR, each rule required or advisory): minimum time at previous step; minimum classes/attendance (since last promotion and/or total); minimum age; prerequisite step; required curriculum items completed; pass a grading event; manual instructor sign-off.
- **Curriculum** (per step): grouped techniques/forms/concepts, optional media, optionally checkable per student. **Instructor-authored content is authoritative.**

### Per-student data
- **Enrollment** (student ↔ discipline): current step position in that discipline.
- **Progression log** (immutable): each award references the **step and the system version** at award time, the date, the awarding instructor, and notes.

### Engine behavior
- **Eligibility evaluator:** given a student's position, attendance, age, and curriculum completion, compute eligible next step(s) and "how close" per criterion — this powers the "ready / close / not yet" dashboard.
- **Promotion action:** award the step, write the immutable log entry, advance the enrollment, and fire the certificate/notification.
- **Config validation:** ordering is coherent, criteria reference valid steps, no gaps.

### Templates (the practical on-ramp)
- Ship a **curated, built-in template library** (BJJ adult, BJJ kids, Shotokan kyu/dan, WT Taekwondo, Judo, generic levels, …). Admins clone and customize — most never start from a blank page.
- Templates are **community-contributable** (a natural fit for open source) and are the safest, highest-quality path to a working setup.

## 13. AI assistance — optional & pluggable

### Principles
- **AI is a convenience layer, never a dependency.** The engine and manual configuration are the source of truth; everything works with AI disabled. This mirrors the adapter principle in §3.
- **Pluggable provider** (Anthropic/Claude, OpenAI, a self-hostable local model via Ollama, or none) — self-hosters choose or turn it off.
- **AI never gates or decides ranks.** No auto-promotion. A human stays in the loop for anything affecting a student's progression. AI helps *author* configuration and content and *assist* people; the deterministic engine does the evaluating.

### High-value uses
1. **Natural-language system setup:** "I teach BJJ, adult and kids" → AI proposes a complete starter system (belts, stripes, kids tiers, sensible time-in-grade and age rules) for the admin to review and edit. Collapses tedious setup into a conversation.
2. **Curriculum drafting:** AI drafts a per-rank syllabus to curate — draft-to-edit, since the school's own curriculum is authoritative and AI can err.
3. **Config copilot:** "add a green belt with two stripes between yellow and blue, requiring 6 months and 40 classes" → a proposed configuration change.
4. **Config sanity-check:** flags inconsistencies ("no time requirement between white and blue — intended?").
5. **Member-facing / "better page":** progress summaries, "what to focus on next," draft promotion announcements, answering member questions about requirements.
6. **Localization:** draft translations of curriculum and announcements into Swedish/Norwegian/Danish/Finnish for human review (ties to §5).
7. **Migration:** AI-assisted parsing of an existing belt spreadsheet/CSV into the engine.

### The smart pattern (cost + quality + open source)
Prefer the **curated template library over per-tenant AI calls** — "standard BJJ belts" is identical for everyone, so a vetted shared template beats a fresh generation each time. Use AI mainly for genuinely custom or novel setups, and feed good AI-generated configs back into the community template library after review. On the hosted side, cache/reuse to control API cost.

### GDPR / privacy (EU-first)
- Configuration and template tasks use **no personal data** → low risk.
- Member-facing tasks involve **personal data** → an external AI provider becomes a **sub-processor** (needs a DPA, data minimization, possibly consent). Prefer not sending PII, make such features opt-in, or use a self-hostable/local model. This ties directly to the controller/processor split in §5.

---

### One-line takeaway
Build the dojo's administrative backbone quietly and well, then pour your design energy into the martial-arts journey — a **generic, admin-configurable rank engine** (with optional AI to help set it up), grading, curriculum, competition, and member progress. Being **martial-arts-native, open-source (AGPL, self-hostable), and EU/Nordic-first**, built to a high quality bar rather than a deadline, is what makes it the best *dojo* app rather than just another gym app.
