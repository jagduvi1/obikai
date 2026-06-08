import { describe, expect, it } from 'vitest';
import { contentHash, stableStringify } from '../src/canonical.js';

/**
 * Byte-stability guard for `contentHash` — the basis of every rank-system `versionId` (ADR-0005) and,
 * via the same primitive, the GDPR audit hash-chain. The exact digest MUST never change: a different
 * value would re-mint every existing version id and break immutable promotion history + audit-chain
 * verification. This pins the digest for a fixed input so a dependency change (e.g. the @noble/hashes
 * v1→v2 upgrade) that altered the output would fail CI. Do NOT update these snapshots to make CI pass —
 * a change here means the upgrade is NOT byte-compatible and must not land.
 */
describe('contentHash byte-stability', () => {
  const fixture = { z: 1, a: [3, 2, 1], nested: { b: 'café', n: null } } as const;

  it('canonicalises key order deterministically', () => {
    expect(stableStringify(fixture)).toMatchInlineSnapshot(
      `"{"a":[3,2,1],"nested":{"b":"café","n":null},"z":1}"`,
    );
  });

  it('produces a stable sha256 hex for a fixed input', () => {
    expect(contentHash(fixture)).toMatchInlineSnapshot(
      `"c11ec3dbf3bc0df99d624a7a6d25995ed00c4d8168f6ff692204b1e939f6d523"`,
    );
  });

  it('hashes an empty object stably', () => {
    expect(contentHash({})).toMatchInlineSnapshot(
      `"08525c8cec37cbdf0935447cfa5b1e2086129305a304904858067b51fbc9f2b1"`,
    );
  });
});
