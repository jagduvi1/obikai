# 0029 — Translatable rank/curriculum content (i18n H4)

**Status:** Accepted · 2026-06-08

## Context

Invariant 6 requires **translatable rank/curriculum content** (a Swedish dojo wants "Vitt bälte", a
Finnish one "Valkoinen vyö"). The UI *chrome* is already translated (ADR via `@obikai/i18n`; the
language switcher + Swedish landed in #93–#95). What remains is the **content data** authored by each
dojo: discipline names, curriculum item labels, and their descriptions.

The obvious worry was the **rank-versioning invariant** (invariant 5, ADR-0005): a
`ProgressionSystemVersion` is immutable and its `versionId` is a content hash, and promotion history
pins that `versionId`. If human labels fed the hash, adding a Swedish translation would mint a new
version and break history.

**Investigation result: they don't.** The engine's versioned config is purely structural —
`Step` = `{ id, kind, order, trackId, visual, criteria, curriculumId }`, `Track` = `{ id, age bounds }`,
`Curriculum` = `{ id, groups }`. There are **no human-readable strings in the hashed config at all**
(`mintVersion` hashes `disciplineId/systemId/presentation/tracks/ladder/transitions/curricula`). The
human content lives in **separate app-layer entities**, already keyed to the engine ids:

- `Discipline { name, description }`
- `CurriculumItem { itemKey, label, description }` — its doc comment already says "gives them
  translatable labels/media for the UI".

So translatable content is **already decoupled from the `versionId`**. H4 needs **no engine change, no
immutability concern, and no `versionId` migration.**

## Decision

1. **Model translatable content as `LocalizedString`** (`Partial<Record<Locale,string>>`, already in
   `@obikai/domain`, designed for exactly this). The fields that become `LocalizedString`:
   - `Discipline.name`, `Discipline.description`
   - `CurriculumItem.label`, `CurriculumItem.description`

   `GradingEvent.name` stays a plain string for now — it's a one-off event title ("Spring Grading
   2026"), not reusable rank vocabulary; revisit if dojos ask.

2. **The API returns the raw `LocalizedString`; the SPA resolves it** with `resolveLocalized(value,
   { requested: activeLocale, defaultLocale })`. Rationale: the SPAs already hold the active locale
   (the i18n language), `resolveLocalized` is a pure domain function with deterministic fallback
   (requested → tenant default → en → first present), and this avoids adding request-locale
   (Accept-Language) plumbing to the API. The blast radius is small (admin disciplines/curriculum +
   member progress).

3. **Authoring is multi-locale.** Create/update DTOs accept `localizedStringSchema`; the admin
   authoring UI offers a per-locale field set (at minimum the tenant default + English, with the other
   Nordic locales optional). At least one locale is required (`localizedStringSchema` enforces it).

4. **Migration** rewrites existing `string` values to `{ en: value }` (forward-only, `migrate-mongo`).
   Pre-launch there is no production data, so this is effectively a seed-data convenience; it makes the
   change safe regardless.

## Consequences

- No change to the rank engine, `mintVersion`, `versionId`, or promotion-history immutability — the
   crown-jewel invariant is untouched. (The `@noble/hashes`-v2 byte-stability tests from #98 continue to
   pin the hash.)
- Cross-cutting but bounded: domain types + zod, `@obikai/db` models/mappers + a migration, the
   disciplines/curriculum API DTOs, and two SPAs. Implemented as: **(PR-1)** domain + db + migration +
   API + the two UIs (the `string`→object change must land with its consumers to stay green);
   optionally split member-display from admin-authoring if the diff is large.
- A `LocalizedString` with only `en` renders as English everywhere via the fallback — so untranslated
   content degrades gracefully, exactly like the nb/da/fi UI stubs.
- Tenant default locale: `resolveLocalized` takes a `defaultLocale`. Until a per-tenant authoring
   locale exists, the SPA passes `DEFAULT_LOCALE` ('en') as the default; a tenant-configurable default
   is a small follow-up.
