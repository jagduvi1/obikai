# 0028 — Deny-by-default npm install scripts (supply-chain hardening)

**Status:** Accepted · 2026-06-08

## Context

A dependency's `preinstall` / `install` / `postinstall` lifecycle scripts run **automatically** during
`pnpm install`, with the developer's full privileges, before any code review. This is one of the most
exploited supply-chain vectors: a typosquatted or compromised package ships a malicious install script
that harvests credentials, env vars, and git/SSH material the moment it lands in `node_modules`.

An active 2026 campaign made this concrete: five typosquatted npm packages (e.g. `supabase-javascript`,
`ms-graph-types`) carried a `preinstall` script executing a bundled credential-stealing binary, and also
dropped a project-level `.claude/settings.json` `SessionStart` hook so the binary **re-ran every time the
AI coding agent opened the project** — persistence that survived `node_modules` deletion.

pnpm 9 (our pinned `packageManager`, `pnpm@9.15.9`) runs dependency build scripts by default; pnpm 10
flips to deny-by-default. We do not want to silently inherit arbitrary install-time code execution from
the full transitive closure (585 packages). A scan of the tree found exactly **seven** packages that
declare install scripts:

| Package | Script | Needed? |
|---|---|---|
| `esbuild` | postinstall | **yes** — links the platform native binary (vite/vitest) |
| `@swc/core` | postinstall | **yes** — native transform for the integration-test config (ADR/I1–I3) |
| `@biomejs/biome` | postinstall | **yes** — resolves the biome native binary (`pnpm lint`) |
| `unrs-resolver` | postinstall | **yes** — native resolver for the eslint import-boundaries gate (`pnpm boundaries`) |
| `@nestjs/core` | postinstall | no — OpenCollective funding message |
| `mongodb-memory-server` | postinstall | no — the `mongod` binary downloads lazily at runtime |
| `msgpackr-extract` | install | no — optional native accelerator for `msgpackr`; pure-JS fallback |

## Decision

Adopt **deny-by-default** for dependency install scripts via pnpm's allowlist, in the root
`package.json`:

```jsonc
"pnpm": {
  "onlyBuiltDependencies": ["@biomejs/biome", "@swc/core", "esbuild", "unrs-resolver"]
}
```

With `onlyBuiltDependencies` present, pnpm runs lifecycle scripts **only** for the listed packages; every
other dependency's `pre`/`install`/`post`install is blocked. The list is the **minimal** set our build,
lint, boundaries, and test toolchain genuinely needs — all four ship a native binary. We deliberately do
**not** set `.npmrc` `ignore-scripts=true`: that is a global off-switch that would also block the four
essentials and break the build; the allowlist is the precise tool.

This mirrors the project's existing deny-by-default posture (ADR-0008 license allowlist) and complements
the per-PR Dependabot review where package identity/version is vetted before merge.

## Consequences

- A typosquatted / compromised dependency added to the tree **cannot execute install-time code** unless
  it is also added to the allowlist — which is a reviewed, deliberate change in `package.json`, not a
  silent transitive effect.
- **Adding a package that needs a build step**: a clean install will print
  `dependencies have build scripts that were ignored: <name>`. Only after confirming the package is
  trusted and the script is genuinely required, add its name to `onlyBuiltDependencies` and run
  `pnpm rebuild`. Keep the list minimal.
- Verified on a clean reinstall: only the four allowlisted postinstalls ran; `@nestjs/core`,
  `mongodb-memory-server`, and `msgpackr-extract` were skipped. Full toolchain stayed green —
  `pnpm build` / `typecheck` / `lint` / `boundaries`, api **184 unit + 9 integration**, worker **26**
  (incl. the Redis-backed I3 suite). In particular `mongodb-memory-server` still downloads its binary
  lazily, and `msgpackr` (BullMQ) works via its JS fallback, both with their scripts blocked.
- Not covered by this ADR: install scripts of the project's **own** workspace packages still run (we
  control those), and runtime code execution is unaffected (this is install-time only). Agent hook
  config (`.claude/settings.json`) is treated as security-sensitive and reviewed like CI workflows.
