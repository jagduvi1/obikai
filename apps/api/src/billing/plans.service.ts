import { type AuthzActor, can } from '@obikai/authz';
import {
  type BillingInterval,
  type Plan,
  type PlanCreateInput,
  type PlanType,
  money,
} from '@obikai/domain';

/**
 * PlansService — business logic + RBAC enforcement for membership plans (templates; ADR-0011/0013).
 * Plans describe what a member can be enrolled on, so they are gated on the `membership` resource
 * (staff+owner by default). Framework-free (no Nest imports) so it unit-tests against a fake store
 * with explicit actors; the controller translates these errors to HTTP. Tenant scoping is already
 * guaranteed by the request's TenantContext (ADR-0004). Money is rebuilt from the DTO's
 * priceMinor + currency into the domain `Money` shape (integer minor units, ADR-0013).
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

/** The persistence surface PlansService needs — satisfied by @obikai/db's PlanRepository. */
export interface PlansStore {
  create(input: {
    name: string;
    type: PlanType;
    price: ReturnType<typeof money>;
    interval: BillingInterval;
    vatRateId?: string | null;
    classPackCredits?: number | null;
    active?: boolean;
  }): Promise<Plan>;
  findById(id: string): Promise<Plan | null>;
  list(opts?: { active?: boolean }): Promise<Plan[]>;
  update(
    id: string,
    patch: {
      name?: string;
      active?: boolean;
      vatRateId?: string | null;
      classPackCredits?: number | null;
    },
  ): Promise<Plan | null>;
  remove(id: string): Promise<boolean>;
}

export interface PlanUpdateInput {
  name?: string;
  active?: boolean;
  vatRateId?: string | null;
  classPackCredits?: number | null;
}

export class PlansService {
  constructor(private readonly store: PlansStore) {}

  async create(actor: AuthzActor, input: PlanCreateInput): Promise<Plan> {
    if (!can(actor, { resource: 'membership', action: 'create' }))
      throw new ForbiddenError('create', 'membership');
    return this.store.create({
      name: input.name,
      type: input.type,
      price: money(input.priceMinor, input.currency),
      interval: input.interval,
      vatRateId: input.vatRateId ?? null,
      classPackCredits: input.classPackCredits ?? null,
      active: input.active,
    });
  }

  async list(actor: AuthzActor, opts: { active?: boolean } = {}): Promise<Plan[]> {
    if (!can(actor, { resource: 'membership', action: 'list' }))
      throw new ForbiddenError('list', 'membership');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<Plan> {
    if (!can(actor, { resource: 'membership', action: 'read' }))
      throw new ForbiddenError('read', 'membership');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('plan', id);
    return existing;
  }

  async update(actor: AuthzActor, id: string, patch: PlanUpdateInput): Promise<Plan> {
    if (!can(actor, { resource: 'membership', action: 'update' }))
      throw new ForbiddenError('update', 'membership');
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('plan', id);
    return updated;
  }

  async remove(actor: AuthzActor, id: string): Promise<void> {
    if (!can(actor, { resource: 'membership', action: 'delete' }))
      throw new ForbiddenError('delete', 'membership');
    const ok = await this.store.remove(id);
    if (!ok) throw new NotFoundError('plan', id);
  }
}
