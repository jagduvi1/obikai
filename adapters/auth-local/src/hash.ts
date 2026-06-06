/**
 * Password hashing for the local auth adapter.
 *
 * ADR-0004's TARGET hashing algorithm is **argon2id**. That requires a native build
 * (`node-gyp`), which we deliberately avoid in Phase 0 to keep the default self-host install
 * dependency-free and cross-platform. This module is the swappable INTERIM: `node:crypto`'s
 * `scryptSync` — a memory-hard KDF available in every supported Node runtime with NO native
 * dependency. The encoded format below is self-describing, so a future migration to argon2id
 * can detect interim hashes by their `scrypt$` prefix and rehash on next successful login
 * without a schema change.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** scrypt cost parameter (CPU/memory). 2^15 = 32768 is the Node default; safe and portable. */
const SCRYPT_N = 16384;
/** Salt length in bytes. */
const SALT_BYTES = 16;
/** Derived key length in bytes. */
const KEY_BYTES = 64;
/** Encoded-hash field separator and scheme tag. */
const SCHEME = 'scrypt';
const SEPARATOR = '$';

/**
 * Hash a plaintext password into a self-describing, storable string:
 * `scrypt$<N>$<saltHex>$<hashHex>`. A fresh random salt is generated per call.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_BYTES, { N: SCRYPT_N });
  return [SCHEME, String(SCRYPT_N), salt.toString('hex'), derived.toString('hex')].join(SEPARATOR);
}

/**
 * Verify a plaintext password against an encoded hash produced by {@link hashPassword}.
 * Uses a constant-time comparison to avoid leaking match progress via timing. Returns `false`
 * (never throws) for malformed or unknown-scheme encodings, so a corrupt stored value can never
 * be mistaken for a valid credential.
 */
export function verifyPassword(password: string, encoded: string): boolean {
  const parts = encoded.split(SEPARATOR);
  if (parts.length !== 4) {
    return false;
  }
  const [scheme, nRaw, saltHex, hashHex] = parts;
  if (scheme !== SCHEME || nRaw === undefined || saltHex === undefined || hashHex === undefined) {
    return false;
  }
  const n = Number.parseInt(nRaw, 10);
  if (!Number.isInteger(n) || n <= 0) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || expected.length === 0) {
    return false;
  }
  const actual = scryptSync(password, salt, expected.length, { N: n });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
