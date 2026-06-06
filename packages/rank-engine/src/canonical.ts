import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

/**
 * Canonical serialization for content hashing (ADR-0005). The versionId is a hash over this, so
 * it MUST be deterministic: object keys are sorted, arrays keep their (semantic) order, and the
 * scheme is version-prefixed so a future hash-scheme change never retroactively alters historic
 * versionIds. Pure + isomorphic (no node:crypto) so the engine runs identically in the browser.
 */

const SCHEME_PREFIX = 'obikai-rank-v1:';

export function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const v = obj[key];
    if (v === undefined) continue; // omit undefined so optional-field jitter can't change the hash
    out[key] = canonicalize(v);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function contentHash(value: unknown): string {
  // @noble/hashes UTF-8-encodes string input internally — keeps this isomorphic (no TextEncoder/node).
  return bytesToHex(sha256(SCHEME_PREFIX + stableStringify(value)));
}
