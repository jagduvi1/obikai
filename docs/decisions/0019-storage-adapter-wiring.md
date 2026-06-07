# 0019 — Storage adapter wiring & the guarded `/files` route

**Status:** Accepted · 2026-06-07

## Context

The `StoragePort` contract and its two default implementations (fs, s3) existed (ADR-0003/0009), but
**nothing in the api consumed them** — there was no injectable `StoragePort` and no route to actually
move bytes for the self-host fs default. This blocked every file feature (waiver documents first,
later avatars/attachments). The port deliberately speaks **presigned URLs only** — the app never
streams object bytes *through* the adapter (invariant 10): for s3 the URL points at S3 directly; for
fs the adapter mints an HMAC-signed URL to a guarded app route that must exist.

## Decision

- **`StorageModule.forRoot(config)`** (global) resolves and provides a single `STORAGE_PORT` from
  `STORAGE_PROVIDER` (ADR-0009). Built where the validated `AppConfig` is available (wired in
  `AppModule.forRoot`), it constructs the provider with an `AdapterContext` (Nest-backed logger, real
  clock, env-only `readSecret`) and calls `init()`.
- **The s3 adapter is imported dynamically** (`await import('@obikai/adapter-storage-s3')`) so fs
  deployments never load `@aws-sdk` — keeping the self-host footprint small (invariant 10).
- **Two new config inputs for fs** (the s3 path is unchanged):
  - `STORAGE_PUBLIC_BASE_URL` — the externally-reachable origin the `/files` route is served from
    (required when `STORAGE_PROVIDER=fs`; the adapter bakes it into presigned URLs).
  - The fs presign **signing secret is derived from `DATA_MASTER_KEY`** via a labelled HMAC subkey
    (`deriveStorageSigningSecret`) — no new required secret, cryptographically separated from other
    uses of the master key.
- **`FilesController` (`GET`/`PUT /files/*`) is mounted only for fs.** It verifies the adapter's HMAC
  token (op + key + expiry, constant-time), resolves the key to a path strictly inside the storage
  root via the adapter's traversal-safe `resolveObjectPath`, then streams bytes to/from disk with a
  defensive upload cap (20 MB). Uploads must use a **binary Content-Type** so Nest's JSON/urlencoded
  body parsers leave the request a raw stream. The security-relevant decisions (key extraction,
  authorization, content-type) are pure helpers (`files.support.ts`), unit-tested with tokens minted
  by the real adapter (valid / expired / op-mismatch / wrong-key / tampered / missing).

## Consequences

- Any feature module can now inject `STORAGE_PORT` and hand out presigned upload/download URLs;
  waiver signed-documents (next PR) is the first consumer.
- The fs default works on a single box with zero external services (built-ins only). Operators
  running fs behind a reverse proxy must route `/files/*` to the api (the api serves it at root, like
  `/auth`, `/health`); s3 deployments need no such route.
- CI builds but never boots the app, so a `StorageModule.forRoot` shape+factory test guards the DI
  wiring (fs mounts the controller and provides `FILES_CONFIG`; s3 does neither) — the one class of
  bug the build can't catch.

## Alternatives considered

- **Stream object bytes through the `StoragePort`**: rejected — invariant 10 keeps large transfers off
  the app process; presigned URLs let the client talk to storage directly (and for s3, never touch
  the app at all).
- **A dedicated `STORAGE_SIGNING_SECRET` env**: rejected — one more required secret for operators;
  deriving a labelled subkey from `DATA_MASTER_KEY` is equally safe and zero-config.
- **Static-import the s3 adapter**: rejected — it would pull `@aws-sdk` into every fs/self-host
  install. Dynamic import defers the cost to s3 deployments only.
- **Always mount `/files`**: rejected — it is meaningless under s3 (presigns go to S3). Gating it on
  `provider==='fs'` keeps the s3 surface minimal.
