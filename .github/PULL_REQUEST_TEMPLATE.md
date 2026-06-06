<!-- Thanks for contributing to Obikai. NOTE: external PRs cannot be merged until the
     contribution agreement (CLA vs no-CLA) is decided — see CONTRIBUTING.md. -->

## What & why

<!-- What does this change and why? Link the issue / scope section (e.g. docs/scope.md §4.5). -->

## Type

- [ ] feat
- [ ] fix
- [ ] refactor
- [ ] docs
- [ ] test
- [ ] chore

## Checklist

- [ ] Stays within the 10 invariants in `CLAUDE.md`
- [ ] Tests added/updated (rank-engine & billing changes need edge-case/property tests)
- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally
- [ ] `pnpm license:check` passes (no AGPL-incompatible dependency added)
- [ ] Import boundaries respected (`pnpm boundaries`) — esp. `rank-engine` imports only `domain`
- [ ] `pnpm changeset` added if a published package changed
- [ ] Docs updated (user / admin / self-host / API / contributor) where relevant
- [ ] No secrets committed; new config is env-driven and documented in `.env.example`
- [ ] Accessibility considered for member-facing UI (WCAG 2.1 AA)
