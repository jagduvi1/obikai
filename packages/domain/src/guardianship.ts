import { z } from 'zod';
import type { MemberId, TenantId, UserId } from './ids.js';
import type { Permission } from './rbac.js';

/**
 * Guardianship — a parent/guardian → minor-member delegation edge (ADR-0004, scope §4.10). A guardian
 * is a tenant-global User (a login) who may act on behalf of one or MORE minor Members per a granted
 * permission set; they need NOT be a Member themselves, and if they ALSO train they keep their own
 * Member record on the SAME user (one account, two hats). Deliberately separate from the Household
 * (billing) unit — a payer need not be a guardian and vice versa.
 *
 * The authz primitive is `GuardianshipGrant` in @obikai/authz (consumed by `can()`); this is the
 * persisted record the repository stores and the tenancy middleware loads into the request actor.
 */
export interface Guardianship {
  readonly id: string;
  readonly tenantId: TenantId;
  /** The guardian's tenant-global login account. */
  readonly guardianUserId: UserId;
  /** The minor member this guardian may act for. One guardian → many minors = many rows. */
  readonly minorMemberId: MemberId;
  /** What the guardian may do on the minor's records (see DEFAULT_GUARDIAN_GRANTS in @obikai/authz). */
  readonly grants: readonly Permission[];
  /** Set when the link is revoked; a revoked edge is ignored by `can()`. */
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

/** Create input — `grants` defaults to the guardian default set at the service layer when omitted. */
export const guardianshipCreateSchema = z.object({
  guardianUserId: z.string().min(1),
  minorMemberId: z.string().min(1),
});
export type GuardianshipCreateInput = z.infer<typeof guardianshipCreateSchema>;
