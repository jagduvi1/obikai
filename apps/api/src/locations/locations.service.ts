import { type AuthzActor, can } from '@obikai/authz';
import type { Location, LocationCreateInput, LocationUpdateInput } from '@obikai/domain';

/**
 * LocationsService — business logic + RBAC enforcement for the Locations feature (scope §4.10). It
 * is deliberately framework-free (no Nest imports) so it unit-tests against a fake store with
 * explicit actors. The controller translates these errors to HTTP. Tenant scoping is already
 * guaranteed by the request's TenantContext (ADR-0004); this layer decides WHAT the actor may do
 * (ADR-0004 can()).
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

/** The persistence surface LocationsService needs — satisfied by @obikai/db's LocationRepository. */
export interface LocationsStore {
  create(input: LocationCreateInput): Promise<Location>;
  findById(id: string): Promise<Location | null>;
  list(): Promise<Location[]>;
  update(id: string, patch: LocationUpdateInput): Promise<Location | null>;
}

export class LocationsService {
  constructor(private readonly store: LocationsStore) {}

  async create(actor: AuthzActor, input: LocationCreateInput): Promise<Location> {
    if (!can(actor, { resource: 'location', action: 'create' }))
      throw new ForbiddenError('create', 'location');
    return this.store.create(input);
  }

  async list(actor: AuthzActor): Promise<Location[]> {
    if (!can(actor, { resource: 'location', action: 'list' }))
      throw new ForbiddenError('list', 'location');
    return this.store.list();
  }

  async get(actor: AuthzActor, id: string): Promise<Location> {
    if (!can(actor, { resource: 'location', action: 'read' }))
      throw new ForbiddenError('read', 'location');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('location', id);
    return existing;
  }

  async update(actor: AuthzActor, id: string, patch: LocationUpdateInput): Promise<Location> {
    if (!can(actor, { resource: 'location', action: 'update' }))
      throw new ForbiddenError('update', 'location');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('location', id);
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('location', id);
    return updated;
  }
}
