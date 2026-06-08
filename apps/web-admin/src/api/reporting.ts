import { api } from '@obikai/api-client';
import type { OwnerDashboard } from '@obikai/domain';

/** The action-oriented owner dashboard (§4.9). */
export function getOwnerDashboard(): Promise<OwnerDashboard> {
  return api.get<OwnerDashboard>('/reporting/dashboard');
}
