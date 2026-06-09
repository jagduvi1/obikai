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
  findByMemberOccurrence(memberId: string, occurrenceId: string): Promise<Attendance | null>;
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
    // Idempotent for occurrence-based check-ins: re-marking a member already recorded for this
    // occurrence returns the EXISTING row rather than a duplicate — so an instructor double-tapping
    // the roster (or a "mark all present" re-run) can't inflate the attendance count that feeds the
    // rank engine. Ad-hoc records with no occurrenceId are still recorded each time.
    if (input.occurrenceId) {
      const existing = await this.store.findByMemberOccurrence(input.memberId, input.occurrenceId);
      if (existing) return existing;
    }
    return this.store.record(input);
  }

  async list(actor: AuthzActor, filter: AttendanceFilter = {}): Promise<Attendance[]> {
    // When scoped to one member, that member (self-access) or their guardian (the guardianship edge)
    // may list it — both flow through can() with ownerMemberId. Otherwise (tenant-wide listing) the
    // role catalog must grant 'list'. Passing ownerMemberId never widens a role grant (branch 1
    // ignores it), so staff/owner are unaffected.
    const scopedToMember =
      filter.memberId !== undefined &&
      can(actor, { resource: 'attendance', action: 'list', ownerMemberId: filter.memberId });
    if (!scopedToMember && !can(actor, { resource: 'attendance', action: 'list' })) {
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
