import { type AuthzActor, can } from '@obikai/authz';
import type { Member, MemberCreateInput, MemberStatus, MemberUpdateInput } from '@obikai/domain';

/**
 * MembersService — business logic + RBAC enforcement for the Members feature (scope §4.1). It is
 * deliberately framework-free (no Nest imports) so it unit-tests against a fake store with explicit
 * actors. The controller translates these errors to HTTP. Tenant scoping is already guaranteed by
 * the request's TenantContext (ADR-0004); this layer decides WHAT the actor may do (ADR-0004 can()).
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

/** The persistence surface MembersService needs — satisfied by @obikai/db's MemberRepository. */
export interface MembersStore {
  create(input: MemberCreateInput): Promise<Member>;
  findById(id: string): Promise<Member | null>;
  list(opts?: { status?: MemberStatus }): Promise<Member[]>;
  update(id: string, patch: MemberUpdateInput): Promise<Member | null>;
  remove(id: string): Promise<boolean>;
}

export class MembersService {
  constructor(private readonly store: MembersStore) {}

  async create(actor: AuthzActor, input: MemberCreateInput): Promise<Member> {
    if (!can(actor, { resource: 'member', action: 'create' }))
      throw new ForbiddenError('create', 'member');
    return this.store.create(input);
  }

  async list(actor: AuthzActor, opts: { status?: MemberStatus } = {}): Promise<Member[]> {
    if (!can(actor, { resource: 'member', action: 'list' }))
      throw new ForbiddenError('list', 'member');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<Member> {
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('member', id);
    // ownerMemberId enables self-access (a member may read their own record) and guardianship.
    if (!can(actor, { resource: 'member', action: 'read', ownerMemberId: existing.id })) {
      throw new ForbiddenError('read', 'member');
    }
    return existing;
  }

  async update(actor: AuthzActor, id: string, patch: MemberUpdateInput): Promise<Member> {
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('member', id);
    if (!can(actor, { resource: 'member', action: 'update', ownerMemberId: existing.id })) {
      throw new ForbiddenError('update', 'member');
    }
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('member', id);
    return updated;
  }

  async remove(actor: AuthzActor, id: string): Promise<void> {
    if (!can(actor, { resource: 'member', action: 'delete' }))
      throw new ForbiddenError('delete', 'member');
    const ok = await this.store.remove(id);
    if (!ok) throw new NotFoundError('member', id);
  }
}
