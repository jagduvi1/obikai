import { z } from 'zod';
import type { LocationId, TenantId } from './ids.js';

/** A physical dojo location (multi-location support, scope §4.10). RBAC roles can be scoped to a
 * set of location ids (ADR-0004). Each location pins its own timezone for scheduling/attendance. */
export interface Location {
  readonly id: LocationId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly timezone: string;
  readonly address: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const locationCreateSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1).default('Europe/Stockholm'),
  address: z.string().nullable().optional(),
});
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export const locationUpdateSchema = locationCreateSchema.partial();
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;
