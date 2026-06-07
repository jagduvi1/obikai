import { api } from '@obikai/api-client';
import type { PlatformAuditEntry, Tenant, TenantStatus } from '@obikai/domain';

/**
 * Platform (cross-tenant) API bindings (ADR-0022/0024). All read-only. The shared api-client adds
 * the Bearer token; the server's PlatformMiddleware enforces the PlatformGrant (a 403 surfaces as an
 * ApiError the pages render). Endpoints live under `/platform/*`.
 */

export function listTenants(): Promise<Tenant[]> {
  return api.get<Tenant[]>('/platform/tenants');
}

export function getTenant(slug: string): Promise<Tenant> {
  return api.get<Tenant>(`/platform/tenants/${encodeURIComponent(slug)}`);
}

/** Per-tenant usage counts (computed by the api scoping into the tenant). */
export interface TenantUsage {
  readonly tenantId: string;
  readonly status: TenantStatus;
  readonly members: number;
  readonly activeMembers: number;
}
export function getTenantUsage(slug: string): Promise<TenantUsage> {
  return api.get<TenantUsage>(`/platform/tenants/${encodeURIComponent(slug)}/usage`);
}

/** The whole tamper-evident platform audit chain, oldest → newest. */
export function listAudit(): Promise<PlatformAuditEntry[]> {
  return api.get<PlatformAuditEntry[]>('/platform/audit');
}
