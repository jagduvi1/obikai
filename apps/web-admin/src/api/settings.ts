import { api } from '@obikai/api-client';
import type { BillingProfileInput, TenantBillingProfile } from '@obikai/domain';

/**
 * Settings API bindings (ADR-0018). The seller billing/legal profile shown on invoices: GET returns
 * the current tenant's profile or null (not configured yet); PUT create-or-replaces it (owner only).
 */
export function getBillingProfile(): Promise<TenantBillingProfile | null> {
  return api.get<TenantBillingProfile | null>('/settings/billing-profile');
}

export function saveBillingProfile(input: BillingProfileInput): Promise<TenantBillingProfile> {
  return api.put<TenantBillingProfile>('/settings/billing-profile', input);
}
