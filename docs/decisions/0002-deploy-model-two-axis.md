# 0002 — Two-axis deploy model (`deployMode` × `tenancy`)

**Status:** Accepted · 2026-06-06 · decided with the product owner

## Context

Invariant 2 requires one codebase, two deployment modes, selected by config, never forked.
`docs/scope.md` §3 leaves open whether self-host should also support multi-tenant (an
association/federation hosting several clubs). Early drafts spelled the deploy mode three
incompatible ways (`hosted-multitenant`/`selfhost-singletenant`, `self-host`/`hosted`), which
would fragment the single config seam the invariant depends on (Zod enums fail to unify).

## Decision

Model deployment as **two orthogonal axes**, defined **once** in `@obikai/config` and imported
everywhere (local re-declaration is lint-forbidden):

```ts
type DeployMode = 'self-host' | 'hosted';
type Tenancy    = 'single' | 'multi';
```

- **Self-host** defaults to `single` but is **federation-capable**: `TENANCY=multi` lets one
  instance host several clubs without a code fork. (Product owner decision: capable, default off.)
- The tenant-resolution and isolation code path (ADR-0004) is **byte-identical in all modes**.
  Self-host single-tenant simply resolves the one seeded tenant — there is **no "skip tenant
  filter" branch**. This is what keeps self-host from silently becoming an unscoped leak vector
  and what makes enabling federation later a config flip, not a rewrite.

## Consequences

- `single` vs `multi` only changes tenant *provisioning/resolution* (one seeded tenant vs
  host-header lookup), never the query-scoping guarantees.
- A test runs the full suite in self-host mode and asserts the tenant guard still throws on
  missing context (self-host is not silently unscoped).

## Alternatives considered

A single conflated enum (`hosted-multitenant`…): rejected — entangles "who operates it" with
"how many tenants", and made federation a new enum value (a fork risk). Strictly single-tenant
self-host: rejected — associations are a real Nordic use case and retrofitting tenancy is
painful (scope §7).
