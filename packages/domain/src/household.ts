import { z } from 'zod';
import type { HouseholdId, MemberId, TenantId, UserId } from './ids.js';

/**
 * Household — the billing/family unit (ADR-0011): one payer, many member students; charges roll
 * up here. The payer may be a member (`payerMemberId`) or a tenant-global user (`payerUserId`).
 * Deliberately SEPARATE from legal guardianship (the `Guardianship` edge, ADR-0004): a payer need
 * not be a guardian, and vice versa.
 */
export interface Household {
  readonly id: HouseholdId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly payerMemberId: MemberId | null;
  readonly payerUserId: UserId | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const householdCreateSchema = z
  .object({
    name: z.string().min(1),
    payerMemberId: z.string().min(1).nullable().optional(),
    payerUserId: z.string().min(1).nullable().optional(),
  })
  .refine((h) => !(h.payerMemberId && h.payerUserId), {
    message: 'a household has at most one payer (member OR user, not both)',
    path: ['payerMemberId'],
  });
export type HouseholdCreateInput = z.infer<typeof householdCreateSchema>;
