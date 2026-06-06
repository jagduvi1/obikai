import { type AuthzActor, can } from '@obikai/authz';
import type { BillingProfileInput, TenantBillingProfile } from '@obikai/domain';

/**
 * BillingProfileService — business logic + RBAC for the seller billing/legal profile (ADR-0018).
 * Framework-free so it unit-tests against a fake store. Tenant scoping is guaranteed by the request's
 * TenantContext (ADR-0004); this layer decides WHAT the actor may do via `can()` on the
 * `tenantSettings` resource (owner edits; staff read).
 */
export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

/** Persistence surface — satisfied by @obikai/db's BillingProfileRepository. */
export interface BillingProfileStore {
  get(): Promise<TenantBillingProfile | null>;
  upsert(input: BillingProfileInput): Promise<TenantBillingProfile>;
}

export class BillingProfileService {
  constructor(private readonly store: BillingProfileStore) {}

  async get(actor: AuthzActor): Promise<TenantBillingProfile | null> {
    if (!can(actor, { resource: 'tenantSettings', action: 'read' }))
      throw new ForbiddenError('read', 'tenantSettings');
    return this.store.get();
  }

  async upsert(actor: AuthzActor, input: BillingProfileInput): Promise<TenantBillingProfile> {
    if (!can(actor, { resource: 'tenantSettings', action: 'update' }))
      throw new ForbiddenError('update', 'tenantSettings');
    return this.store.upsert(input);
  }
}
