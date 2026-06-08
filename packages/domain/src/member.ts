import { z } from 'zod';
import type { HouseholdId, MemberId, TenantId, UserId } from './ids.js';

/**
 * Member — a person enrolled at a dojo (ADR-0011). A member may have no login (a young child),
 * their own login, or be billed via a household payer. `dateOfBirth` drives youth/adult tracks and
 * age guards (the rank engine receives it as an injected Instant; ADR-0005).
 */

export const MEMBER_STATUSES = ['lead', 'trial', 'active', 'frozen', 'cancelled'] as const;
export type MemberStatus = (typeof MEMBER_STATUSES)[number];
export const memberStatusSchema = z.enum(MEMBER_STATUSES);

/** Dojo-defined free-text labels on a member (e.g. "competitor", "kids", "needs-waiver"). */
export const MEMBER_TAG_MAX_LEN = 50;
export const MEMBER_TAGS_MAX = 50;
export const memberTagSchema = z.string().trim().min(1).max(MEMBER_TAG_MAX_LEN);
/**
 * A normalized tag list: each entry trimmed, blanks dropped, deduped (order-preserving), then
 * validated (per-tag length + overall count). Forgiving of UI input (an empty row is dropped, not a
 * 400), but a genuinely over-long tag still fails.
 */
export const memberTagsSchema = z
  .array(z.string())
  .transform((tags) => [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))])
  .pipe(z.array(memberTagSchema).max(MEMBER_TAGS_MAX));

export interface EmergencyContact {
  readonly name: string;
  readonly phone: string;
  readonly relation: string | null;
}

export interface Member {
  readonly id: MemberId;
  readonly tenantId: TenantId;
  /** Tenant-global login link (ADR-0004), or null for a member without an account. */
  readonly userId: UserId | null;
  readonly householdId: HouseholdId | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string | null;
  readonly phone: string | null;
  /** ISO calendar date `YYYY-MM-DD`, or null. */
  readonly dateOfBirth: string | null;
  readonly status: MemberStatus;
  /** ISO calendar date the member joined, or null for leads. */
  readonly joinDate: string | null;
  readonly emergencyContact: EmergencyContact | null;
  readonly notes: string | null;
  /** Dojo-defined labels for segmentation (comms targeting, reporting cohorts). */
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A way to target a set of members (comms recipients, reporting cohorts). `all` = every member;
 * `status` = a single lifecycle status (e.g. all trials); `tag` = everyone carrying a label. Richer
 * rule-based segments are a later enhancement (ADR — see decisions log).
 */
export type MemberSegment =
  | { readonly kind: 'all' }
  | { readonly kind: 'status'; readonly status: MemberStatus }
  | { readonly kind: 'tag'; readonly tag: string };

export const memberSegmentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('status'), status: memberStatusSchema }),
  z.object({ kind: z.literal('tag'), tag: memberTagSchema }),
]);

/** Pure membership test for a segment — the canonical definition, mirrored by the DB query layer. */
export function memberMatchesSegment(
  member: Pick<Member, 'status' | 'tags'>,
  segment: MemberSegment,
): boolean {
  switch (segment.kind) {
    case 'all':
      return true;
    case 'status':
      return member.status === segment.status;
    case 'tag':
      return member.tags.includes(segment.tag);
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected an ISO calendar date YYYY-MM-DD');

const emergencyContactSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1),
  relation: z.string().nullable().default(null),
});

/** Validated input to create a member (the API DTO). Tenant + ids are assigned server-side. */
export const memberCreateSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  dateOfBirth: isoDate.nullable().optional(),
  householdId: z.string().min(1).nullable().optional(),
  status: memberStatusSchema.default('lead'),
  joinDate: isoDate.nullable().optional(),
  emergencyContact: emergencyContactSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: memberTagsSchema.optional(),
});
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

/** Validated input to update a member — every field optional (partial patch). */
export const memberUpdateSchema = memberCreateSchema.partial();
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;
