import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveObjectPath } from '../src/index.js';

/**
 * `resolveObjectPath` is the ONLY defense stopping the guarded `/files` route from reading/writing
 * arbitrary paths on the self-host box (it's invoked at presign-mint time AND in the GET/PUT handlers).
 * The sibling HMAC token logic is well-covered; this closes the matching gap on the traversal guard.
 */
const ROOT = resolve('/srv/obikai-objects');

describe('resolveObjectPath', () => {
  it('resolves a legitimate nested key to a path strictly inside root', () => {
    const p = resolveObjectPath(ROOT, 'waivers/t1/abc.pdf');
    expect(p.startsWith(ROOT)).toBe(true);
    expect(p).not.toBe(ROOT);
  });

  it('rejects empty, dot, root-equivalent, traversal, and absolute keys', () => {
    for (const bad of [
      '', // empty
      '.', // resolves to root itself
      'a/..', // resolves back to root
      '..', // parent of root
      '../etc/passwd', // climbs out
      'a/../../etc/passwd', // climbs out via nesting
      '/etc/passwd', // absolute (leading slash is absolute on posix AND win32)
    ]) {
      expect(() => resolveObjectPath(ROOT, bad), `should reject: ${JSON.stringify(bad)}`).toThrow();
    }
  });
});
