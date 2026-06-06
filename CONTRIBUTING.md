# Contributing to Obikai

Thank you for your interest. Obikai is **quality-first**: time is not the constraint —
correctness, clean architecture, strong tests, accessibility, and documentation are.

> [!IMPORTANT]
> **The contribution agreement is undecided (CLA vs DCO/no-CLA).** This is a human-owned
> business decision (see [docs/decisions/0010-cla-pending.md](docs/decisions/0010-cla-pending.md)).
> Until it is resolved, **external pull requests cannot be merged** — but issues, design
> discussion, and draft PRs are very welcome. This file documents both paths so we can switch
> on a single decision.

## Ground rules

- **Read [`CLAUDE.md`](CLAUDE.md) and [`docs/scope.md`](docs/scope.md)** before substantial work.
  The 10 invariants in `CLAUDE.md` are non-negotiable.
- **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`).
- **Small, reviewable changes.** One logical change per commit.
- **Tests alongside code.** The rank engine and billing get rigorous edge-case/property tests.
- **Keep CI green** (typecheck, lint, tests, **AGPL license check**, security scan).
- **Keep `CHANGELOG.md` current** (we use [Changesets](https://github.com/changesets/changesets)).

## Dependency license hygiene (hard rule)

Obikai is AGPL-3.0. Every dependency must be AGPL-compatible — permissive (MIT/ISC/BSD/Apache-2.0)
is fine. A CI gate (`pnpm license:check`) **fails the build** on anything outside the allowlist
(see [docs/decisions/0008-license-posture.md](docs/decisions/0008-license-posture.md)). If you
add a dependency with a new license, expect to justify it.

## Workflow

```bash
git checkout -b feat/<short-description>
pnpm install
# … make changes, add tests …
pnpm typecheck && pnpm lint && pnpm test && pnpm license:check
pnpm changeset            # describe your change for the changelog
```

Open a PR against `main`. Never commit directly to `main`.

## Architecture boundaries (CI-enforced)

Import boundaries are mechanically enforced (`pnpm boundaries`). The most important:
**`packages/rank-engine` may import only `packages/domain`** — never a DB, an adapter, a
framework, or the AI adapter. If your change needs the engine to reach outside that, it almost
certainly belongs in the app layer instead. See
[docs/decisions/0003-monorepo-and-boundaries.md](docs/decisions/0003-monorepo-and-boundaries.md).

## The two contribution-agreement paths (pending decision)

- **(a) Pure community AGPL, no CLA** — maximal goodwill; the project is permanently AGPL and
  cannot be unilaterally relicensed. We would still use a **DCO** (`Signed-off-by:` via
  `git commit -s`) to prove provenance.
- **(b) AGPL + CLA** — contributors grant relicensing rights, keeping a future commercial /
  dual-license option open. Adds some contributor friction.

Once decided, this section becomes the actual process and the gate is lifted.
