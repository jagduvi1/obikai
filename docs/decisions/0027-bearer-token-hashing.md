# 0027 — Bearer-token handling: SHA-256 hashing for high-entropy tokens, KDF only for passwords, hardened refresh cookie

**Status:** Accepted · 2026-06-08

## Context

The account plane stores three kinds of secret-derived material at rest:

1. **User passwords** — low-entropy, human-chosen (~30–40 effective bits), guessable.
2. **Rotating refresh tokens** (`token.service.ts`) — 256-bit `randomBytes` values.
3. **Password-reset tokens** (E1, `auth.service.ts`) — 256-bit `randomBytes` values, single-use, 1h TTL.

For (2) and (3) we store only `sha256(token)` and look the token up by that hash (a unique-indexed,
O(1) at-rest lookup key). For (1) the password is hashed with a slow, memory-hard KDF (scrypt today,
argon2id target per ADR-0004) inside the `auth-local` adapter — the password never reaches the
SHA-256 path.

CodeQL's `js/insufficient-password-hash` (security-extended suite) raised a **high-severity** alert on
the reset-token `sha256Hex` (`auth.service.ts`), message "Password … is hashed insecurely". The
identical refresh-token pattern in `token.service.ts` was **not** flagged.

This was adversarially reviewed (three independent reviewers + a synthesizer, one explicitly tasked to
steelman the alert). All concluded, high-confidence, that it is a **false positive**.

## Decision

- **Hash high-entropy bearer tokens (reset, refresh) with a single fast SHA-256; do not use a slow KDF
  for them.** A KDF's work factor only matters for low-entropy, guessable secrets. A 256-bit uniform
  random token has a 2^256 keyspace: brute force is infeasible regardless of per-guess cost, tokens are
  self-salting (globally unique), and recovering a token from its hash requires a SHA-256 preimage on a
  full-entropy input. A KDF here adds nothing and would add CPU to the **unauthenticated**
  `password-reset/request` endpoint — a DoS amplification vector. It would also break the O(1) indexed
  `tokenHash` lookup these flows depend on.
- **Keep the slow KDF exactly where it belongs:** on the actual user password, in the `auth-local`
  adapter (`hashPassword`, scrypt → argon2id), reached via `AuthPort.setPassword`.
- **Defense-in-depth is layered, not via the hash:** reset tokens are single-use (atomic
  `consumeIfValid` CAS on `{usedAt:null, expiresAt>now}`), expire in 1h, are superseded on each new
  request, and a successful reset revokes **all** of the user's sessions.
- **Treat the CodeQL alert as a documented false positive (dismissed "won't fix / false positive").**
  Inline `// codeql[...]` suppression is **not** honored by our default `github/codeql-action` setup
  (no SARIF baseline/suppression config), so the dismissal in the GitHub Security tab — not a code
  comment — is the authoritative gate-clearing action. A clarifying comment sits above `sha256Hex` for
  future readers and points here. The same dismissal rationale applies pre-emptively to the
  refresh-token path if/when CodeQL flags it.

## Optional, not adopted

Keying the token hash with HMAC-SHA256 (over `AUTH_JWT_SECRET`/`DATA_MASTER_KEY`) would stop a
DB-only compromise from forging a `tokenHash` lookup without the server key. This is genuine
defense-in-depth against a *different, weaker* threat than hash brute force, and is **not required for
correctness**. If ever adopted it must be applied uniformly to both reset and refresh tokens, keeping
the atomic consume/rotate semantics. Tracked as a possible future hardening, not done here.

## Refresh-token delivery (addendum)

The rotating refresh token is delivered to browsers as the cookie value itself, set with
`httpOnly: true`, `secure: true` (prod; off only on loopback), `sameSite: 'strict'`, `path: '/'`.
CodeQL `js/clear-text-storage-of-sensitive-data` flags this (it has no model of cookie attributes and
treats any bearer credential reaching `res.cookie` as cleartext storage). It is a **false positive,
dismissed**:

- A bearer refresh cookie's value **must equal the secret** to function — that is how the mechanism
  works. Any reversible wrapping just yields an equivalent bearer secret, so "encrypting the cookie
  value" adds nothing (whoever can read the cookie can also replay it).
- Every concrete attack is already mitigated: XSS read → blocked by `httpOnly`; plaintext-network leak
  → blocked by `Secure`; CSRF → blocked by `SameSite=strict`; DB/cookie theft → the value is an opaque
  256-bit `randomBytes`, stored server-side only as `sha256`, with rotation + reuse-detection, and a
  password change revokes all sessions first. This is the OWASP-recommended pattern (preferred over
  `localStorage`).
- Tell of a false positive: the identical `respond()` cookie path used by register/login/refresh is not
  flagged — the alert is only a new taint *source* (`changePassword`) reaching the pre-existing sink.

## Consequences

- Token storage stays fast, indexed, and uniform across reset + refresh paths.
- The KDF cost is paid once, on the password, in the adapter — the single correct place.
- A reusable convention is recorded so future contributors (and future CodeQL runs) don't "fix" a
  non-bug by slow-hashing tokens.
