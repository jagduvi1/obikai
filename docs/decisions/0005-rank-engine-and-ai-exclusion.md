# 0005 — Pure rank engine, versioning & structural AI exclusion

**Status:** Accepted · 2026-06-06 · supersedes an earlier divergent draft of the engine

## Context

The rank engine is the product's spine (`docs/scope.md` §12). Invariant 5: declarative config +
deterministic evaluator; "belt" is presentation, not assumption (must handle kyu/dan, levels,
belt-less arts); rank systems versioned; promotion history immutable, referencing the version
granted under. Invariant 4: AI never in the rank-decision path, never auto-promotes.
Two early drafts disagreed (Date vs Instant clock, system-level vs per-step presentation,
decimal vs float) — this ADR fixes the single canonical contract.

## Decision

`@obikai/rank-engine` is a **pure, deterministic, framework/DB-agnostic** package (imports only
`domain`; ADR-0003). Its entire public surface is five pure functions — no class state, no I/O,
no async:

```
validateConfig(candidate)               // the ONLY ingress for AI- or human-authored config
mintVersion(prior, validatedDraft)      // pure: canonical content hash -> versionId
evaluateEligibility(version, input, ctx) // pure, total
promote(version, input, award, ctx)      // pure; returns a proposed immutable log entry
resolveTransition(version, input, ctx)   // youth -> adult crossing
```

**Model:** `Discipline → versioned ProgressionSystem → ordered ladder of typed Steps`
(`rank | marker/stripe | dan | level`). **`VisualSpec` is per-step** (belt/sash/armband/level/
tier/none) and never read during evaluation — belt is presentation only; belt-less arts work by
construction. Criteria are a discriminated-union **AND/OR tree**, each leaf `required |
advisory`; evaluation returns per-criterion "how close".

**Determinism:** the clock enters as an explicit `Instant` + a **pinned tenant timezone**
(stored with the progression, never the viewer's); Temporal for calendar/age math, decimal.js
for ratios. No `Date.now()`, `Math.random()`, locale, or ambient timezone in the package. Inputs
are snapshots the **app** assembles (attendance-since-last-promotion, age, curriculum
completion); the engine never fetches and never persists.

**Versioning/immutability:** copy-on-write `ProgressionSystemVersion`; **`versionId` is a hash
over a CANONICAL serialization** (deterministic key sort, arrays-not-Sets, integer-encoded
durations, fixed scheme prefix) so logically-identical configs dedupe and changed configs never
reuse an id. Each `PromotionLogEntry` pins `{systemId, versionId, stepId}`; the app persists it.

**AI exclusion is structural, enforced two ways:** (1) the engine package has no AI dependency
and no API accepting a prompt/model — AI can only emit candidate config that must pass
`validateConfig` + human approval before `mintVersion`; (2) `scripts/assert-rank-engine-purity.mjs`
asserts the built engine's dependency closure contains no `ai-*`/anthropic/openai/ollama package.
Force-promote requires a **human-entered** `overrideReason` (never AI-populated) and always emits
an audit event.

## Consequences

- Property tests (fast-check) cover: more attendance never lowers status; no promotion with an
  unmet required criterion; `mintVersion` is stable under key/array reordering and changes on
  any semantic change; eligibility is invariant under process-`TZ` changes and input reordering.
- Identical bytes run hosted and self-host; tenancy lives entirely in the app layer.

## Alternatives considered

Stripes as a `stripeCount` attribute (can't carry their own criteria/curriculum); a repository
passed into the engine for lazy loading (reintroduces I/O + non-determinism); `now: Date`
(ambient-tz non-determinism); float month math (silent rounding); an `aiAssist` fast-path
(puts AI on the decision path). All rejected.
