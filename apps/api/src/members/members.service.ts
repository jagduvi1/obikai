import { type AuthzActor, can } from '@obikai/authz';
import type { AuditAppendInput } from '@obikai/db';
import type {
  Member,
  MemberCreateInput,
  MemberStatus,
  MemberUpdateInput,
  UserId,
} from '@obikai/domain';

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
  list(opts?: { status?: MemberStatus; tag?: string }): Promise<Member[]>;
  search(query: string, limit?: number): Promise<Member[]>;
  update(id: string, patch: MemberUpdateInput): Promise<Member | null>;
  remove(id: string): Promise<boolean>;
}

/**
 * The per-tenant GDPR audit surface — satisfied by @obikai/db's `AuditLogRepository`. Member is a core
 * data subject, so every MUTATION of a member record is recorded for accountability (Art. 5(2)/30,
 * audit H9). Reads are not audited (normal in-tenant operation; auditing them would bloat the chain).
 */
export interface AuditPort {
  append(input: AuditAppendInput): Promise<unknown>;
}

/** Request-derived audit context threaded from the controller (PII-minimized: source IP only). */
export interface AuditMeta {
  readonly ip?: string;
}

export class MembersService {
  constructor(
    private readonly store: MembersStore,
    private readonly audit: AuditPort,
  ) {}

  /** Record a member mutation on the tenant's audit chain. `diff` carries changed FIELD NAMES only. */
  private recordMutation(
    actor: AuthzActor,
    action: 'member.create' | 'member.update' | 'member.delete',
    targetId: string,
    meta: AuditMeta,
    diff?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.audit.append({
      actorId: actor.userId as UserId,
      actorType: 'user',
      action,
      targetType: 'member',
      targetId,
      ...(diff !== undefined ? { diff } : {}),
      ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
    });
  }

  async create(actor: AuthzActor, input: MemberCreateInput, meta: AuditMeta = {}): Promise<Member> {
    if (!can(actor, { resource: 'member', action: 'create' }))
      throw new ForbiddenError('create', 'member');
    const created = await this.store.create(input);
    // Audit-after-success: the resulting id is only known post-create. The residual crash window
    // (created but not yet audited) closes once create+append run in one transaction (replica set).
    await this.recordMutation(actor, 'member.create', created.id, meta);
    return created;
  }

  async list(
    actor: AuthzActor,
    opts: { status?: MemberStatus; tag?: string } = {},
  ): Promise<Member[]> {
    if (!can(actor, { resource: 'member', action: 'list' }))
      throw new ForbiddenError('list', 'member');
    return this.store.list(opts);
  }

  /** Staff member lookup over name/email/phone (kiosk roster add, comms recipient picker). */
  async search(actor: AuthzActor, query: string, limit?: number): Promise<Member[]> {
    if (!can(actor, { resource: 'member', action: 'list' }))
      throw new ForbiddenError('list', 'member');
    return this.store.search(query, limit);
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

  async update(
    actor: AuthzActor,
    id: string,
    patch: MemberUpdateInput,
    meta: AuditMeta = {},
  ): Promise<Member> {
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('member', id);
    if (!can(actor, { resource: 'member', action: 'update', ownerMemberId: existing.id })) {
      throw new ForbiddenError('update', 'member');
    }
    const updated = await this.store.update(id, patch);
    if (!updated) throw new NotFoundError('member', id);
    // PII-minimized diff: record WHICH fields changed, never the personal-data values themselves.
    await this.recordMutation(actor, 'member.update', id, meta, { fields: Object.keys(patch) });
    return updated;
  }

  async remove(actor: AuthzActor, id: string, meta: AuditMeta = {}): Promise<void> {
    if (!can(actor, { resource: 'member', action: 'delete' }))
      throw new ForbiddenError('delete', 'member');
    const ok = await this.store.remove(id);
    if (!ok) throw new NotFoundError('member', id);
    // A hard delete is irreversible — recording the actor/target/time is the whole point of H9.
    await this.recordMutation(actor, 'member.delete', id, meta);
  }
}
