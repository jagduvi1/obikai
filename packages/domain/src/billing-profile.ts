import { z } from 'zod';
import type { BillingProfileId, TenantId } from './ids.js';

/**
 * The tenant's seller billing/legal profile (ADR-0018). These are the SELLER details an EU-compliant
 * invoice must show — legal name, VAT registration number, organisation number, and registered
 * address — plus optional payment instructions and a footer note. It is tenant-OWNED config (one per
 * tenant, guarded), distinct from the tenant-global registry `Tenant` entity (ADR-0017) which only
 * holds slug/name/status.
 *
 * Invoices snapshot `sellerVatId` at issue time (ADR-0013); this profile is the source of truth the
 * api reads when issuing and when rendering invoice PDFs.
 */
export interface TenantBillingProfile {
  readonly id: BillingProfileId;
  readonly tenantId: TenantId;
  /** Registered legal name of the dojo/operator (required — the minimum a valid invoice needs). */
  readonly legalName: string;
  /** VAT registration number (e.g. "SE556677889901"); null until set. Drives reverse-charge notes. */
  readonly vatId: string | null;
  /** Company/organisation registration number (e.g. Swedish organisationsnummer). */
  readonly registrationNumber: string | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  /** ISO 3166-1 alpha-2 country code (e.g. "SE"). */
  readonly country: string | null;
  /** Contact/billing email shown on invoices. */
  readonly email: string | null;
  /** Free-text payment instructions (IBAN/BIC, Bankgiro, Swish) for manual-payment invoices. */
  readonly paymentDetails: string | null;
  /** Free-text legal footer printed on every invoice. */
  readonly footerNote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Upsert input for the billing profile (PUT semantics — the whole editable profile). `legalName` is
 * required; every other field is optional and may be explicitly null to clear it.
 */
export const billingProfileInputSchema = z.object({
  legalName: z.string().min(1).max(200),
  vatId: z.string().max(64).nullable().optional(),
  registrationNumber: z.string().max(64).nullable().optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  postalCode: z.string().max(32).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, 'country must be a 2-letter ISO 3166-1 alpha-2 code')
    .nullable()
    .optional(),
  email: z.string().email().max(254).nullable().optional(),
  paymentDetails: z.string().max(2000).nullable().optional(),
  footerNote: z.string().max(2000).nullable().optional(),
});
export type BillingProfileInput = z.infer<typeof billingProfileInputSchema>;
