import { type AuthzActor, can } from '@obikai/authz';
import type { VatRate, VatRateCreateInput } from '@obikai/domain';

/**
 * VatRatesService — business logic + RBAC enforcement for per-tenant VAT rates (ADR-0013). VAT
 * rates are tenant configuration, so they are gated on the `tenantSettings` resource (owner-only by
 * default). Framework-free (no Nest imports) so it unit-tests against a fake store with explicit
 * actors; the controller translates these errors to HTTP. Tenant scoping is already guaranteed by
 * the request's TenantContext (ADR-0004).
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/** Raised when deleting a VAT rate still referenced by one or more plans (would break their billing). */
export class VatRateInUseError extends Error {
  constructor(id: string) {
    super(`vat rate ${id} is in use by one or more plans and cannot be deleted`);
    this.name = 'VatRateInUseError';
  }
}

/** The persistence surface VatRatesService needs — satisfied by @obikai/db's VatRateRepository. */
export interface VatRatesStore {
  create(input: { name: string; percent: number }): Promise<VatRate>;
  findById(id: string): Promise<VatRate | null>;
  list(): Promise<VatRate[]>;
  update(id: string, patch: { name?: string; percent?: number }): Promise<VatRate | null>;
  remove(id: string): Promise<boolean>;
  /** True if any plan references this VAT rate (deletion guard). */
  isReferencedByPlan(id: string): Promise<boolean>;
}

export class VatRatesService {
  constructor(private readonly store: VatRatesStore) {}

  async create(actor: AuthzActor, input: VatRateCreateInput): Promise<VatRate> {
    if (!can(actor, { resource: 'tenantSettings', action: 'create' }))
      throw new ForbiddenError('create', 'tenantSettings');
    return this.store.create({ name: input.name, percent: input.percent });
  }

  async list(actor: AuthzActor): Promise<VatRate[]> {
    if (!can(actor, { resource: 'tenantSettings', action: 'list' }))
      throw new ForbiddenError('list', 'tenantSettings');
    return this.store.list();
  }

  async get(actor: AuthzActor, id: string): Promise<VatRate> {
    if (!can(actor, { resource: 'tenantSettings', action: 'read' }))
      throw new ForbiddenError('read', 'tenantSettings');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('vatRate', id);
    return existing;
  }

  async update(
    actor: AuthzActor,
    id: string,
    patch: { name?: string; percent?: number },
  ): Promise<VatRate> {
    if (!can(actor, { resource: 'tenantSettings', action: 'update' }))
      throw new ForbiddenError('update', 'tenantSettings');
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('vatRate', id);
    return updated;
  }

  async remove(actor: AuthzActor, id: string): Promise<void> {
    if (!can(actor, { resource: 'tenantSettings', action: 'delete' }))
      throw new ForbiddenError('delete', 'tenantSettings');
    // Referential-integrity guard: a rate still attached to a plan must not be deleted, or that plan's
    // recurring invoices would fail to resolve a VAT percent on the next billing run.
    if (await this.store.isReferencedByPlan(id)) throw new VatRateInUseError(id);
    const ok = await this.store.remove(id);
    if (!ok) throw new NotFoundError('vatRate', id);
  }
}
