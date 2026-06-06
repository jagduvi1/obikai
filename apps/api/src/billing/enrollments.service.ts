import { type AuthzActor, can } from '@obikai/authz';
import type { Enrollment, EnrollmentCreateInput, EnrollmentStatus } from '@obikai/domain';

/**
 * EnrollmentsService — business logic + RBAC enforcement for enrollments (a member on a plan;
 * ADR-0011/0013). Enrollments are membership operations, gated on the `membership` resource
 * (staff+owner by default). Framework-free (no Nest imports) so it unit-tests against a fake store
 * with explicit actors; the controller translates these errors to HTTP. Tenant scoping is already
 * guaranteed by the request's TenantContext (ADR-0004). Freeze/cancel are simple status
 * transitions here (proration/period math rides the billing service + worker).
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

/** The persistence surface EnrollmentsService needs — satisfied by @obikai/db's EnrollmentRepository. */
export interface EnrollmentsStore {
  create(input: {
    memberId: string;
    planId: string;
    startDate: string;
    status?: EnrollmentStatus;
  }): Promise<Enrollment>;
  findById(id: string): Promise<Enrollment | null>;
  list(opts?: { memberId?: string }): Promise<Enrollment[]>;
  update(
    id: string,
    patch: {
      status?: EnrollmentStatus;
      freezeFrom?: string | null;
      freezeUntil?: string | null;
      cancelAt?: string | null;
    },
  ): Promise<Enrollment | null>;
}

export class EnrollmentsService {
  constructor(private readonly store: EnrollmentsStore) {}

  async create(actor: AuthzActor, input: EnrollmentCreateInput): Promise<Enrollment> {
    if (!can(actor, { resource: 'membership', action: 'create' }))
      throw new ForbiddenError('create', 'membership');
    return this.store.create({
      memberId: input.memberId,
      planId: input.planId,
      startDate: input.startDate,
      status: 'active',
    });
  }

  async list(actor: AuthzActor, opts: { memberId?: string } = {}): Promise<Enrollment[]> {
    if (!can(actor, { resource: 'membership', action: 'list' }))
      throw new ForbiddenError('list', 'membership');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<Enrollment> {
    if (!can(actor, { resource: 'membership', action: 'read' }))
      throw new ForbiddenError('read', 'membership');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('enrollment', id);
    return existing;
  }

  /** Freeze an enrollment over an optional window; sets status to 'frozen' (ADR-0014). */
  async freeze(
    actor: AuthzActor,
    id: string,
    window: { freezeFrom?: string | null; freezeUntil?: string | null } = {},
  ): Promise<Enrollment> {
    if (!can(actor, { resource: 'membership', action: 'update' }))
      throw new ForbiddenError('update', 'membership');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('enrollment', id);
    const updated = await this.store.update(id, {
      status: 'frozen',
      freezeFrom: window.freezeFrom ?? null,
      freezeUntil: window.freezeUntil ?? null,
    });
    if (!updated) throw new NotFoundError('enrollment', id);
    return updated;
  }

  /** Cancel an enrollment; sets status to 'cancelled' and records the optional cancelAt date. */
  async cancel(actor: AuthzActor, id: string, cancelAt?: string | null): Promise<Enrollment> {
    if (!can(actor, { resource: 'membership', action: 'update' }))
      throw new ForbiddenError('update', 'membership');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('enrollment', id);
    const updated = await this.store.update(id, {
      status: 'cancelled',
      cancelAt: cancelAt ?? null,
    });
    if (!updated) throw new NotFoundError('enrollment', id);
    return updated;
  }
}
