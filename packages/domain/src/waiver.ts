import { z } from 'zod';
import type { MemberId, TenantId, WaiverSignatureId, WaiverTemplateId } from './ids.js';

/**
 * Digital waivers incl. minor waivers (ADR-0014, scope §4.10). Templates are VERSIONED; a signature
 * pins the exact template version it was signed under and is immutable + timestamped — so editing a
 * waiver later never rewrites what someone agreed to. Minors are signed for by a guardian.
 */
export interface WaiverTemplate {
  readonly id: WaiverTemplateId;
  readonly tenantId: TenantId;
  readonly title: string;
  readonly bodyMarkdown: string;
  /** Monotonic version; editing the body mints a new version (signatures pin the old one). */
  readonly version: number;
  readonly requiresGuardianForMinor: boolean;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface WaiverSignature {
  readonly id: WaiverSignatureId;
  readonly tenantId: TenantId;
  readonly templateId: WaiverTemplateId;
  readonly templateVersion: number;
  /** The member the waiver covers. */
  readonly memberId: MemberId;
  /** The acting user who signed (guardian or the member's own login), or null for offline import. */
  readonly signedByUserId: string | null;
  readonly signedByName: string;
  readonly isGuardian: boolean;
  /** Set when a guardian signs on behalf of a minor (equals memberId of the minor). */
  readonly guardianForMemberId: MemberId | null;
  readonly signedAt: string;
  readonly ip: string | null;
  /** Object-storage key of the rendered, signed document (S3/MinIO), or null. */
  readonly documentStorageKey: string | null;
  readonly createdAt: string;
}

export const waiverTemplateCreateSchema = z.object({
  title: z.string().min(1),
  bodyMarkdown: z.string().min(1),
  requiresGuardianForMinor: z.boolean().default(true),
  active: z.boolean().default(true),
});
export type WaiverTemplateCreateInput = z.infer<typeof waiverTemplateCreateSchema>;

export const waiverSignSchema = z.object({
  templateId: z.string().min(1),
  memberId: z.string().min(1),
  signedByName: z.string().min(1),
  isGuardian: z.boolean().default(false),
  guardianForMemberId: z.string().min(1).nullable().optional(),
});
export type WaiverSignInput = z.infer<typeof waiverSignSchema>;
