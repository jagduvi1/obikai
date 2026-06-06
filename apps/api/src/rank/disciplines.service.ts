import { type AuthzActor, can } from '@obikai/authz';
import type {
  Discipline,
  DisciplineCreateInput,
  DisciplineUpdateInput,
  PresentationStyle,
} from '@obikai/domain';

/**
 * DisciplinesService — business logic + RBAC for the arts a dojo teaches (ADR-0015). A discipline is
 * top-level rank configuration, gated on the `discipline` resource (owner manages; instructor/staff
 * read). Framework-free so it unit-tests against a fake store with explicit actors; the controller
 * translates these errors to HTTP. Tenant scoping is guaranteed by the request's TenantContext.
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

/** The persistence surface DisciplinesService needs — satisfied by @obikai/db's DisciplineRepository. */
export interface DisciplinesStore {
  create(input: {
    name: string;
    description?: string | null;
    presentation?: PresentationStyle;
    active?: boolean;
  }): Promise<Discipline>;
  findById(id: string): Promise<Discipline | null>;
  list(opts?: { active?: boolean }): Promise<Discipline[]>;
  update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      presentation?: PresentationStyle;
      active?: boolean;
    },
  ): Promise<Discipline | null>;
}

export class DisciplinesService {
  constructor(private readonly store: DisciplinesStore) {}

  async create(actor: AuthzActor, input: DisciplineCreateInput): Promise<Discipline> {
    if (!can(actor, { resource: 'discipline', action: 'create' }))
      throw new ForbiddenError('create', 'discipline');
    return this.store.create({
      name: input.name,
      description: input.description ?? null,
      presentation: input.presentation,
      active: input.active,
    });
  }

  async list(actor: AuthzActor, opts: { active?: boolean } = {}): Promise<Discipline[]> {
    if (!can(actor, { resource: 'discipline', action: 'list' }))
      throw new ForbiddenError('list', 'discipline');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<Discipline> {
    if (!can(actor, { resource: 'discipline', action: 'read' }))
      throw new ForbiddenError('read', 'discipline');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('discipline', id);
    return existing;
  }

  async update(actor: AuthzActor, id: string, patch: DisciplineUpdateInput): Promise<Discipline> {
    if (!can(actor, { resource: 'discipline', action: 'update' }))
      throw new ForbiddenError('update', 'discipline');
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('discipline', id);
    return updated;
  }
}
