import { type AuthzActor, can } from '@obikai/authz';
import type { Program, ProgramCreateInput } from '@obikai/domain';
import { ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * ProgramsService — business logic + RBAC for class Programs (scope §4.3, ADR-0014). Framework-free
 * (no Nest imports) so it unit-tests against a fake store with explicit actors; the controller maps
 * errors to HTTP. Tenant scoping is guaranteed by the request's TenantContext (ADR-0004); this layer
 * decides WHAT the actor may do (RBAC resource 'class', ADR-0004 can()).
 */

/** A partial program update — the create input's mutable fields, all optional. */
export type ProgramUpdateInput = Partial<ProgramCreateInput>;

/** The persistence surface ProgramsService needs — satisfied by @obikai/db's ProgramRepository. */
export interface ProgramsStore {
  create(input: ProgramCreateInput): Promise<Program>;
  findById(id: string): Promise<Program | null>;
  list(opts?: { active?: boolean }): Promise<Program[]>;
  update(id: string, patch: ProgramUpdateInput): Promise<Program | null>;
  remove(id: string): Promise<boolean>;
}

export class ProgramsService {
  constructor(private readonly store: ProgramsStore) {}

  async create(actor: AuthzActor, input: ProgramCreateInput): Promise<Program> {
    if (!can(actor, { resource: 'class', action: 'create' }))
      throw new ForbiddenError('create', 'class');
    return this.store.create(input);
  }

  async list(actor: AuthzActor, opts: { active?: boolean } = {}): Promise<Program[]> {
    if (!can(actor, { resource: 'class', action: 'list' }))
      throw new ForbiddenError('list', 'class');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<Program> {
    if (!can(actor, { resource: 'class', action: 'read' }))
      throw new ForbiddenError('read', 'class');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('program', id);
    return existing;
  }

  async update(actor: AuthzActor, id: string, patch: ProgramUpdateInput): Promise<Program> {
    if (!can(actor, { resource: 'class', action: 'update' }))
      throw new ForbiddenError('update', 'class');
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('program', id);
    return updated;
  }

  async remove(actor: AuthzActor, id: string): Promise<void> {
    if (!can(actor, { resource: 'class', action: 'delete' }))
      throw new ForbiddenError('delete', 'class');
    const ok = await this.store.remove(id);
    if (!ok) throw new NotFoundError('program', id);
  }
}
