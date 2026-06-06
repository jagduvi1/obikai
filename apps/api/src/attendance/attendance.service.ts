import { type AuthzActor, can } from '@obikai/authz';
import type { Attendance, AttendanceCreateInput } from '@obikai/domain';

/**
 * AttendanceService — business logic + RBAC enforcement for check-in (ADR-0014, scope §4.4). It is
 * deliberately framework-free (no Nest imports) so it unit-tests against a fake store with explicit
 * actors. The controller translates these errors to HTTP. Tenant scoping is already guaranteed by
 * the request's TenantContext (ADR-0004); this layer decides WHAT the actor may do (ADR-0004 can()).
 *
 * Rows are immutable, so the surface is record + read-only views. Reads support self-access: a
 * member may always view their OWN attendance (matching their actor.memberId) even if their role
 * lacks the catalog grant — the same self-service principle can() applies to the member record.
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

/** Filter for listing attendance, optionally narrowed to a single discipline. */
export interface AttendanceFilter {
  memberId?: string;
  disciplineId?: string;
}

/** The persistence surface AttendanceService needs — satisfied by @obikai/db's AttendanceRepository. */
export interface AttendanceStore {
  record(input: AttendanceCreateInput): Promise<Attendance>;
  list(filter?: AttendanceFilter): Promise<Attendance[]>;
  classesSinceLastPromotion(memberId: string, disciplineId: string, since: Date): Promise<number>;
}

export class AttendanceService {
  constructor(private readonly store: AttendanceStore) {}

  /** True when the actor is acting on their OWN attendance (self-service read access). */
  private isSelf(actor: AuthzActor, memberId: string | undefined): boolean {
    return actor.memberId !== undefined && memberId !== undefined && actor.memberId === memberId;
  }

  async record(actor: AuthzActor, input: AttendanceCreateInput): Promise<Attendance> {
    if (!can(actor, { resource: 'attendance', action: 'create' }))
      throw new ForbiddenError('create', 'attendance');
    return this.store.record(input);
  }

  async list(actor: AuthzActor, filter: AttendanceFilter = {}): Promise<Attendance[]> {
    // A member may always list their OWN attendance; otherwise the role catalog must grant 'list'.
    if (
      !this.isSelf(actor, filter.memberId) &&
      !can(actor, { resource: 'attendance', action: 'list' })
    ) {
      throw new ForbiddenError('list', 'attendance');
    }
    return this.store.list(filter);
  }

  /**
   * The "classes since last promotion" count that feeds the pure rank engine (ADR-0005). Treated as
   * a read: a member may query their OWN count via self-access, otherwise 'read' is required.
   */
  async classesSinceLastPromotion(
    actor: AuthzActor,
    memberId: string,
    disciplineId: string,
    since: Date,
  ): Promise<number> {
    if (
      !this.isSelf(actor, memberId) &&
      !can(actor, { resource: 'attendance', action: 'read', ownerMemberId: memberId })
    ) {
      throw new ForbiddenError('read', 'attendance');
    }
    return this.store.classesSinceLastPromotion(memberId, disciplineId, since);
  }
}
