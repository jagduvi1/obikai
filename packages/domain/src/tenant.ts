import { z } from 'zod';
import type { TenantId } from './ids.js';

/**
 * The tenant registry entity (ADR-0017). A `Tenant` is one dojo/organization on the platform. It is
 * TENANT-GLOBAL data — the registry *of* tenants, not data *owned by* a tenant — so its persistence
 * is deliberately exempt from `tenantGuard` (like `User`/`Session`, ADR-0004/0012). Enumerating it
 * is a cross-tenant operation and must happen under the explicit `runAsPlatform(...)` marker.
 *
 * The `slug` is the canonical key: it is what the multi-tenant Host-header middleware resolves a
 * request to (ADR-0004), and it IS the `tenantId` carried in every tenant-scoped context and job.
 * `id` and `slug` therefore hold the same value; `id` is the branded form for code that wants a
 * `TenantId`, `slug` the raw string for URLs/hosts.
 */

export const TENANT_STATUSES = ['active', 'suspended', 'archived'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface Tenant {
  /** Branded form of the slug — the resolved `tenantId`. Equals `slug`. */
  readonly id: TenantId;
  /** Canonical key: lowercase DNS-label-safe; resolved from the request Host (multi) or config
   *  (single). This is the value stamped into every tenant-scoped query/job. */
  readonly slug: string;
  /** Human-facing display name (operator-editable; defaults to the slug at bootstrap). */
  readonly name: string;
  readonly status: TenantStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * A DNS-label-safe slug: lowercase alphanumeric and single hyphens, no leading/trailing hyphen,
 * 1–63 chars. It must be safe to use as a subdomain in the hosted (multi-tenant) deployment.
 */
export const tenantSlugSchema = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
    'slug must be lowercase alphanumeric with single internal hyphens (no leading/trailing hyphen)',
  );

export const tenantCreateInputSchema = z.object({
  slug: tenantSlugSchema,
  name: z.string().min(1).max(200),
  status: z.enum(TENANT_STATUSES).optional(),
});
export type TenantCreateInput = z.infer<typeof tenantCreateInputSchema>;
