import { type AuthzActor, can } from '@obikai/authz';
import type { Invoice, InvoiceStatus } from '@obikai/domain';

/**
 * InvoicesService — read-side business logic + RBAC enforcement for invoices (ADR-0013). Issuing,
 * payment recording and dunning live in the framework-free BillingService; this service covers
 * list/get, gated on the `invoice` resource. Framework-free (no Nest imports) so it unit-tests
 * against a fake store with explicit actors; the controller translates these errors to HTTP.
 * Tenant scoping is already guaranteed by the request's TenantContext (ADR-0004).
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

/** The persistence surface InvoicesService needs — satisfied by @obikai/db's InvoiceRepository. */
export interface InvoicesStore {
  findById(id: string): Promise<Invoice | null>;
  list(opts?: { memberId?: string; status?: InvoiceStatus }): Promise<Invoice[]>;
}

export class InvoicesService {
  constructor(private readonly store: InvoicesStore) {}

  async list(
    actor: AuthzActor,
    opts: { memberId?: string; status?: InvoiceStatus } = {},
  ): Promise<Invoice[]> {
    // A member may list ONLY their own invoices (opts scoped to their memberId, via self-access);
    // staff/owner with the 'invoice:list' grant may list any. This prevents a member from
    // enumerating other members' invoices (review fix).
    const ownScope =
      opts.memberId !== undefined &&
      can(actor, { resource: 'invoice', action: 'list', ownerMemberId: opts.memberId });
    if (!ownScope && !can(actor, { resource: 'invoice', action: 'list' })) {
      throw new ForbiddenError('list', 'invoice');
    }
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<Invoice> {
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('invoice', id);
    // ownerMemberId enables a member to read their OWN invoices (self-access via can()).
    if (!can(actor, { resource: 'invoice', action: 'read', ownerMemberId: existing.memberId })) {
      throw new ForbiddenError('read', 'invoice');
    }
    return existing;
  }
}
