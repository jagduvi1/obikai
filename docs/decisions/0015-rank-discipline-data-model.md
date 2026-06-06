# 0015 — Rank/discipline data model & promotion history

**Status:** Accepted · 2026-06-06

## Context

Phase 2 ("the martial-arts heart", scope §9/§12) needs the business + persistence layer around the
pure rank engine (ADR-0005): disciplines, versioned rank systems, each member's current position, an
immutable promotion history, grading events, and curriculum content/completion. The engine itself is
a pure evaluator — it never touches a DB — so this ADR covers the data shapes and where they live,
not the evaluation rules.

## Decision

- **Canonical model lives in `@obikai/domain`, not the engine.** The rank-system model
  (`ProgressionSystemVersion`, `Step`, `PromotionCriterion`, eligibility/promotion I/O) was moved
  from `@obikai/rank-engine` into `@obikai/domain/rank.ts`; the engine re-exports it. Rationale:
  domain is the shared core (entities), the engine is the use-case layer (logic), and `@obikai/db`
  may import **only** `domain`/`config` (ESLint boundaries, ADR-0003) — so persistence needs the
  types in domain. The crown-jewel rule (engine imports only domain) and the purity guard are
  unaffected.
- **Discipline** = one art a dojo teaches; the unit attendance is counted against (ADR-0014). Owns
  exactly one **ProgressionSystem** (unique per discipline).
- **Versioning & immutability (invariant 5).** A `ProgressionSystem` is a logical handle
  (`systemId`, `currentVersionId`, `versionIds[]`); each **`ProgressionSystemVersion` is append-only
  and immutable** — editing a system **mints a new version** (new `versionId`/`contentHash`) via the
  engine and `publishVersion` (which inserts the version and repoints the handle). A re-published
  `versionId` is rejected (`DuplicateVersionError`). The nested config (ladder/tracks/transitions/
  curricula) is stored opaquely (only the engine interprets it).
- **MemberRankState** is the *only* mutable rank record: a member's current step in a discipline
  (unique per `{tenant, member, discipline}`), advanced **solely** by recording a promotion.
- **Promotion** is the **immutable, append-only** history. Each row pins the `systemVersionId` it was
  granted under and freezes the `satisfiedSnapshot` (what was true at award time); an
  `overrideReason` is set iff a human force-promoted past an unmet *required* criterion. No
  update/delete on the repository by design. AI never writes here.
- **GradingEvent** + **GradingResult** (idempotent per `{event, member, step}`) feed
  `passedGradingEvent` criteria. **CurriculumItem** gives the engine's opaque `itemKey`s
  translatable labels/media; **CurriculumCompletion** (idempotent per `{member, discipline, itemKey}`)
  feeds `completedCurriculumItemIds`. The app assembles these into the engine's
  `StudentProgressionInput`; the engine still never queries (ADR-0005).

## Consequences

- The app (api/worker) reads `MemberRankState` + counts attendance + grading/curriculum records to
  build the engine input, calls `evaluateEligibility`/`promote`, then writes a `Promotion` and
  advances `MemberRankState` — keeping the human in the loop (no auto-promotion, invariant 4).
- History survives system edits: an old promotion still references the exact version it was granted
  under, even after newer versions are minted.
- Storing version config opaquely trades schema-level validation for faithful immutability; the
  engine's `validateConfig` is the gate before `mintVersion`, so malformed config never persists.

The HTTP layer (disciplines / rank-systems / promotions / grading-events / curriculum modules) and
the attendance↔eligibility wiring land in follow-up ADRs/PRs.
