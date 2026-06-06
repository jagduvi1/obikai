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
  readonly createdAt: string;
  readonly updatedAt: string;
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
});
export type MemberCreateInput = z.infer<typeof memberCreateSchema>;

/** Validated input to update a member — every field optional (partial patch). */
export const memberUpdateSchema = memberCreateSchema.partial();
export type MemberUpdateInput = z.infer<typeof memberUpdateSchema>;
