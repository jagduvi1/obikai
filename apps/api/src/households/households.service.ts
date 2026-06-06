import { type AuthzActor, can } from '@obikai/authz';
import type { Household, HouseholdCreateInput, Member } from '@obikai/domain';

/**
 * HouseholdsService — business logic + RBAC for the Households feature (scope §4.1). Households are
 * the billing/family admin unit (ADR-0011), so access is gated on the `member` resource (a person
 * who can administer members may administer their household). Deliberately framework-free (no Nest
 * imports) so it unit-tests against fake stores with explicit actors; the controller translates
 * these errors to HTTP. Tenant scoping is already guaranteed by the request's TenantContext
 * (ADR-0004); this layer decides WHAT the actor may do (ADR-0004 can()).
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

/** The household persistence surface — satisfied by @obikai/db's HouseholdRepository. */
export interface HouseholdsStore {
  create(input: HouseholdCreateInput): Promise<Household>;
  findById(id: string): Promise<Household | null>;
  list(): Promise<Household[]>;
  listMembers(householdId: string): Promise<Member[]>;
}

/** The member persistence surface used for household↔member linking — satisfied by MemberRepository. */
export interface MembersLinkStore {
  findById(id: string): Promise<Member | null>;
  update(id: string, patch: { householdId?: string | null }): Promise<Member | null>;
}

export class HouseholdsService {
  constructor(
    private readonly store: HouseholdsStore,
    private readonly members: MembersLinkStore,
  ) {}

  async create(actor: AuthzActor, input: HouseholdCreateInput): Promise<Household> {
    if (!can(actor, { resource: 'member', action: 'create' }))
      throw new ForbiddenError('create', 'member');
    return this.store.create(input);
  }

  async list(actor: AuthzActor): Promise<Household[]> {
    if (!can(actor, { resource: 'member', action: 'list' }))
      throw new ForbiddenError('list', 'member');
    return this.store.list();
  }

  async get(actor: AuthzActor, id: string): Promise<Household> {
    if (!can(actor, { resource: 'member', action: 'read' }))
      throw new ForbiddenError('read', 'member');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('household', id);
    return existing;
  }

  /** Link a member to a household by setting the member's householdId (member-family admin). */
  async linkMember(actor: AuthzActor, householdId: string, memberId: string): Promise<Member> {
    if (!can(actor, { resource: 'member', action: 'update' }))
      throw new ForbiddenError('update', 'member');
    const household = await this.store.findById(householdId);
    if (!household) throw new NotFoundError('household', householdId);
    const member = await this.members.findById(memberId);
    if (!member) throw new NotFoundError('member', memberId);
    const updated = await this.members.update(memberId, { householdId });
    if (!updated) throw new NotFoundError('member', memberId);
    return updated;
  }

  /** Unlink a member from a household, clearing the member's householdId. */
  async unlinkMember(actor: AuthzActor, householdId: string, memberId: string): Promise<void> {
    if (!can(actor, { resource: 'member', action: 'update' }))
      throw new ForbiddenError('update', 'member');
    const household = await this.store.findById(householdId);
    if (!household) throw new NotFoundError('household', householdId);
    const member = await this.members.findById(memberId);
    if (!member || member.householdId !== householdId) throw new NotFoundError('member', memberId);
    const updated = await this.members.update(memberId, { householdId: null });
    if (!updated) throw new NotFoundError('member', memberId);
  }
}
