import { type AuthzActor, can } from '@obikai/authz';
import type { ClassSchedule, ClassScheduleCreateInput } from '@obikai/domain';
import { ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * SchedulesService — business logic + RBAC for recurring ClassSchedules (scope §4.3, ADR-0014).
 * Framework-free; RBAC resource 'class'. A schedule is the RRULE that occurrences are materialized
 * from (see OccurrencesService.materialize).
 */

/** A partial schedule update — the create input's mutable fields, all optional. */
export type ClassScheduleUpdateInput = Partial<ClassScheduleCreateInput>;

/** The persistence surface SchedulesService needs — satisfied by @obikai/db's ClassScheduleRepository. */
export interface SchedulesStore {
  create(input: ClassScheduleCreateInput): Promise<ClassSchedule>;
  findById(id: string): Promise<ClassSchedule | null>;
  list(opts?: { programId?: string; locationId?: string }): Promise<ClassSchedule[]>;
  update(id: string, patch: ClassScheduleUpdateInput): Promise<ClassSchedule | null>;
  remove(id: string): Promise<boolean>;
}

export class SchedulesService {
  constructor(private readonly store: SchedulesStore) {}

  async create(actor: AuthzActor, input: ClassScheduleCreateInput): Promise<ClassSchedule> {
    if (!can(actor, { resource: 'class', action: 'create' }))
      throw new ForbiddenError('create', 'class');
    return this.store.create(input);
  }

  async list(
    actor: AuthzActor,
    opts: { programId?: string; locationId?: string } = {},
  ): Promise<ClassSchedule[]> {
    if (!can(actor, { resource: 'class', action: 'list' }))
      throw new ForbiddenError('list', 'class');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<ClassSchedule> {
    if (!can(actor, { resource: 'class', action: 'read' }))
      throw new ForbiddenError('read', 'class');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('schedule', id);
    return existing;
  }

  async update(
    actor: AuthzActor,
    id: string,
    patch: ClassScheduleUpdateInput,
  ): Promise<ClassSchedule> {
    if (!can(actor, { resource: 'class', action: 'update' }))
      throw new ForbiddenError('update', 'class');
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('schedule', id);
    return updated;
  }

  async remove(actor: AuthzActor, id: string): Promise<void> {
    if (!can(actor, { resource: 'class', action: 'delete' }))
      throw new ForbiddenError('delete', 'class');
    const ok = await this.store.remove(id);
    if (!ok) throw new NotFoundError('schedule', id);
  }
}
