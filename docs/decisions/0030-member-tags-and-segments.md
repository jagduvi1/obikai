# 0030 — Member tags & dynamic segments

**Status:** Accepted · 2026-06-08

## Context

Several feature areas need a way to **target a set of members**: communications (send to "all trials",
"competitors"), reporting cohorts (§4.9), and at-risk detection (§4.1). Before this change a `Member`
had no grouping mechanism at all — `MembersService.list` filtered only by lifecycle `status`.

Two shapes were considered:

1. **Tags + status-derived dynamic segments** — a manual `tags: string[]` on the member, plus segments
   computed from data already present (lifecycle status, later: attendance, billing).
2. **Rule-based saved segments** — a first-class `Segment` entity holding a composable predicate
   (`status = active AND joinDate < 30d AND has-unpaid-invoice`), evaluated on demand and named/saved.

## Decision

Adopt **(1)** now; keep **(2)** as a clearly-scoped later enhancement.

A `MemberSegment` is a small discriminated union — the canonical audience definition:

```ts
type MemberSegment =
  | { kind: 'all' }
  | { kind: 'status'; status: MemberStatus }
  | { kind: 'tag'; tag: string };
```

- **Tags** are dojo-defined free-text labels (`tags: string[]`), normalized by `memberTagsSchema`
  (trim, drop blanks, dedupe order-preserving, per-tag + count caps). Stored on the member, indexed
  `{ tenantId, tags }` (multikey).
- **The predicate `memberMatchesSegment(member, segment)`** in `@obikai/domain` is the single source of
  truth, **mirrored** by the DB query layer (`MemberRepository.list({status|tag})` / `listByTags`) so a
  large tenant resolves a segment with an indexed query, not an in-memory scan.
- A free-text **`MemberRepository.search`** (name/email/phone, regex, tenant-scoped) supports recipient
  pickers and kiosk roster-add. Regex (not a `$text` index) is fine at dojo scale; revisit if a tenant
  grows large.

## Why not rule-based segments now

A rule engine is materially more to build and test (predicate AST, validation, evaluation, persistence,
UI builder) and most real sends are "a status" or "a label". Tags + status cover the immediate needs of
comms/reporting/at-risk with a tiny, well-tested surface. A future `kind: 'rule'` arm slots into the same
`MemberSegment` union and the same resolve-to-members boundary without reworking callers.

## Consequences

- `Member.tags` is a new required (default `[]`) field; `toMember` maps `doc.tags ?? []`. No data
  migration — pre-prod, and the default backfills naturally (invariant: no backward-compat scaffolding).
- New API: `GET /members/search`, `GET /members?tag=`, `PUT /members/:id/tags`. The search route is
  declared **before** `:id` so `/members/search` is not captured as a member id.
- Tag edits are authorized + audited as a member update (PII-minimized diff = field names only).
- Comms (§4.8) resolves a `MemberSegment` to recipients via this boundary; reporting (§4.9) reuses the
  same tag/status filters for cohorts.
