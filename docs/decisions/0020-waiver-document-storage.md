# 0020 — Waiver signed-document storage

**Status:** Accepted · 2026-06-07

## Context

A `WaiverSignature` (ADR-0014) is an immutable, version-pinned record of consent, and it already
carried a `documentStorageKey` seam — but nothing populated it and there was no way to upload or
retrieve the actual signed document (a scan/PDF/photo kept as evidence). With the StoragePort now
wired into the api (ADR-0019), we can implement the flow without the app streaming bytes itself.

## Decision

- **Upload-then-sign.** A client first calls `POST /waivers/documents/upload-url` `{contentType, ext}`
  → the service mints a key under the tenant namespace and returns a **presigned PUT URL**; the
  client uploads bytes directly (S3 → S3; fs → the guarded `/files` route, ADR-0019). The client then
  calls `POST /waivers/sign` with the returned `documentStorageKey`, which is persisted on the
  immutable signature at creation. The signature stays append-only — the key is chosen *before* the
  record exists, never patched in afterward.
- **Per-tenant key namespace, validated at sign time.** Document keys are
  `waivers/{tenantId}/{uuid}.{ext}`. `sign` REJECTS any `documentStorageKey` not inside the resolved
  request tenant's prefix (and rejects a missing tenant). Without this, a client could sign with a
  key pointing at another tenant's object and later obtain a presigned GET for it — a cross-tenant
  read. The extension is sanitised (`[a-z0-9]{1,8}`, else `pdf`).
- **Download is presigned + access-controlled.** `GET /waivers/signatures/:id/document-url` returns a
  presigned GET URL, gated on the same audience as the signature: the covered member (self), their
  guardian (member-update grant), or staff (`waiver:read`/`list`). 404 when no document is attached.
- **Upload authorization** mirrors who may sign: staff (`waiver:create`) or any member (staging their
  own). The StoragePort is injected into `WaiversService` (the first feature consumer of ADR-0019).

## Consequences

- Dojos can retain the actual signed artefact alongside the consent record, on either storage
  backend, with the app never proxying the bytes (invariant 10).
- Cross-tenant isolation holds even though object storage is a flat keyspace: the namespace prefix +
  sign-time validation make a tenant's keys unguessable-by-policy and unusable across tenants.
- The signature's immutability (ADR-0014) is preserved — no update path was added; the key is set
  once, at creation.

## Alternatives considered

- **Patch `documentStorageKey` onto the signature after upload**: rejected — it would add a mutation
  path to a deliberately immutable, legally-meaningful record.
- **Trust a client-supplied key as-is**: rejected — it enables cross-tenant reads; the namespace
  prefix check is the cheap, robust guard.
- **Server-side render+store the document (like invoice PDFs)**: deferred — waiver documents are
  captured externally (scan/drawn signature) for now; the StoragePort has no uniform server-side
  put-bytes across fs/s3, so the presigned client upload is the portable path.
