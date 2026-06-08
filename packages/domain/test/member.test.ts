import { describe, expect, it } from 'vitest';
import {
  type Member,
  type MemberSegment,
  memberMatchesSegment,
  memberSegmentSchema,
  memberTagsSchema,
} from '../src/member.js';

/** A minimal member stub — only the fields the segment predicate reads. */
function stub(
  over: Partial<Pick<Member, 'status' | 'tags'>> = {},
): Pick<Member, 'status' | 'tags'> {
  return { status: 'active', tags: [], ...over };
}

describe('memberTagsSchema (normalization)', () => {
  it('trims, drops empties, and dedupes (order-preserving)', () => {
    expect(memberTagsSchema.parse(['  kids ', 'kids', 'competitor', ''])).toEqual([
      'kids',
      'competitor',
    ]);
  });

  it('rejects a tag over the length cap', () => {
    expect(() => memberTagsSchema.parse(['x'.repeat(51)])).toThrow();
  });
});

describe('memberMatchesSegment', () => {
  it("matches 'all' unconditionally", () => {
    expect(memberMatchesSegment(stub({ status: 'cancelled' }), { kind: 'all' })).toBe(true);
  });

  it("matches 'status' only for the same status", () => {
    const seg: MemberSegment = { kind: 'status', status: 'trial' };
    expect(memberMatchesSegment(stub({ status: 'trial' }), seg)).toBe(true);
    expect(memberMatchesSegment(stub({ status: 'active' }), seg)).toBe(false);
  });

  it("matches 'tag' only when the member carries the tag", () => {
    const seg: MemberSegment = { kind: 'tag', tag: 'competitor' };
    expect(memberMatchesSegment(stub({ tags: ['competitor', 'kids'] }), seg)).toBe(true);
    expect(memberMatchesSegment(stub({ tags: ['kids'] }), seg)).toBe(false);
  });
});

describe('memberSegmentSchema', () => {
  it('accepts each valid shape and rejects an unknown kind', () => {
    expect(memberSegmentSchema.parse({ kind: 'all' })).toEqual({ kind: 'all' });
    expect(memberSegmentSchema.parse({ kind: 'status', status: 'frozen' }).kind).toBe('status');
    expect(memberSegmentSchema.parse({ kind: 'tag', tag: 'vip' }).kind).toBe('tag');
    expect(() => memberSegmentSchema.parse({ kind: 'nope' })).toThrow();
  });
});
