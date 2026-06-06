import type { TenantId, UserId } from '@obikai/domain';
import { z } from 'zod';

/**
 * Consent records (ADR-0007, invariant 6). A consent is per-purpose and tied to the exact
 * policy version in force when it was captured, so a later policy change never silently
 * "re-grants" old consent. Consent is append-only in spirit: a withdrawal is a status change
 * with a timestamp, and the original grant evidence is retained for accountability.
 *
 * This is a pure type + Zod schema. Persistence (a repository) is injected by the app layer —
 * @obikai/gdpr stays DB-agnostic.
 */

/**
 * GDPR Art. 6(1) lawful bases for processing. We model the closed set we actually rely on in
 * Phase 0; `consent` is the only basis a data subject can grant/withdraw, the others justify
 * processing independent of consent (e.g. `legal_obligation` for bookkeeping retention).
 */
export const LAWFUL_BASES = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interests',
  'public_task',
  'legitimate_interests',
] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];
export const lawfulBasisSchema = z.enum(LAWFUL_BASES);

/** A consent is either currently granted or has been withdrawn. */
export const CONSENT_STATUSES = ['granted', 'withdrawn'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];
export const consentStatusSchema = z.enum(CONSENT_STATUSES);

/**
 * Where the consent action originated — for accountability / dispute resolution. Free-form
 * channel descriptor (e.g. 'web-signup-form', 'admin-ui', 'paper-import') kept as a string so
 * tenants can record their own intake channels without a code change.
 */
export type ConsentSource = string;

/**
 * Optional evidence of the consent act (Art. 7(1) — controller must be able to demonstrate
 * consent). PII-minimized: we record *that* and *how*, not a copy of the whole request.
 */
export interface ConsentEvidence {
  /** IP address the action came from, if captured. */
  readonly ip?: string;
  /** User-agent or device descriptor, if captured. */
  readonly userAgent?: string;
  /** Free-text or structured note (e.g. checkbox label shown to the subject). */
  readonly note?: string;
}

export interface ConsentRecord {
  readonly tenantId: TenantId;
  /** The data subject this consent belongs to. */
  readonly subjectId: UserId;
  /** What the consent is for, e.g. 'marketing-email' | 'photo-publication'. */
  readonly purpose: string;
  readonly lawfulBasis: LawfulBasis;
  readonly status: ConsentStatus;
  /** The policy/privacy-notice version in force at grant time, e.g. '2026-06-01'. */
  readonly policyVersion: string;
  readonly grantedAt: Date;
  /** Set iff `status === 'withdrawn'`. `null` while the consent is still granted. */
  readonly withdrawnAt: Date | null;
  readonly source: ConsentSource;
  readonly evidence?: ConsentEvidence;
}

export const consentEvidenceSchema = z
  .object({
    ip: z.string().optional(),
    userAgent: z.string().optional(),
    note: z.string().optional(),
  })
  .strict();

export const consentRecordSchema = z
  .object({
    tenantId: z.string() as unknown as z.ZodType<TenantId>,
    subjectId: z.string() as unknown as z.ZodType<UserId>,
    purpose: z.string().min(1),
    lawfulBasis: lawfulBasisSchema,
    status: consentStatusSchema,
    policyVersion: z.string().min(1),
    grantedAt: z.date(),
    withdrawnAt: z.date().nullable(),
    source: z.string().min(1),
    evidence: consentEvidenceSchema.optional(),
  })
  .strict()
  .refine((c) => (c.status === 'withdrawn' ? c.withdrawnAt !== null : c.withdrawnAt === null), {
    message: 'withdrawnAt must be set iff status is withdrawn',
    path: ['withdrawnAt'],
  });

/**
 * Repository port for consent records — injected by the app layer (no DB coupling here).
 * Records are immutable; withdrawal is expressed by `withdraw` producing the updated row.
 */
export interface ConsentRepository {
  record(consent: ConsentRecord): Promise<void>;
  /** Latest consent state per purpose for a subject. */
  listForSubject(tenantId: TenantId, subjectId: UserId): Promise<readonly ConsentRecord[]>;
  withdraw(
    tenantId: TenantId,
    subjectId: UserId,
    purpose: string,
    at: Date,
  ): Promise<ConsentRecord | null>;
}
