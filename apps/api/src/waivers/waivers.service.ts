import { type AuthzActor, can } from '@obikai/authz';
import type {
  WaiverSignInput,
  WaiverSignature,
  WaiverTemplate,
  WaiverTemplateCreateInput,
} from '@obikai/domain';

/**
 * WaiversService — business logic + RBAC enforcement for digital waivers (ADR-0014, scope §4.10).
 * Framework-free (no Nest imports) so it unit-tests against fake stores with explicit actors; the
 * controller translates these errors to HTTP. Tenant scoping is already guaranteed by the request's
 * TenantContext (ADR-0004); this layer decides WHAT the actor may do (can()).
 *
 * Templates are VERSIONED: editing the body mints a new version in the store. A signature pins the
 * template's CURRENT version at the moment of signing and is immutable, so a later edit never
 * rewrites what someone agreed to.
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

/** The body fields an edit may change; any change mints a new template version in the store. */
export interface WaiverTemplateUpdateInput {
  title?: string;
  bodyMarkdown?: string;
  requiresGuardianForMinor?: boolean;
  active?: boolean;
}

/** Everything needed to persist one immutable, version-pinned signature. */
export interface WaiverSignatureCreateFields {
  templateId: string;
  templateVersion: number;
  memberId: string;
  signedByUserId: string | null;
  signedByName: string;
  isGuardian: boolean;
  guardianForMemberId: string | null;
  signedAt: string;
  ip: string | null;
  documentStorageKey: string | null;
}

/** The template persistence surface — satisfied by @obikai/db's WaiverTemplateRepository. */
export interface WaiverTemplateStore {
  create(input: WaiverTemplateCreateInput): Promise<WaiverTemplate>;
  findById(id: string): Promise<WaiverTemplate | null>;
  list(opts?: { active?: boolean }): Promise<WaiverTemplate[]>;
  updateBody(id: string, patch: WaiverTemplateUpdateInput): Promise<WaiverTemplate | null>;
}

/** The signature persistence surface — satisfied by @obikai/db's WaiverSignatureRepository. */
export interface WaiverSignatureStore {
  create(input: WaiverSignatureCreateFields): Promise<WaiverSignature>;
  findById(id: string): Promise<WaiverSignature | null>;
  listByMember(memberId: string): Promise<WaiverSignature[]>;
  listByTemplate(templateId: string): Promise<WaiverSignature[]>;
}

/** Optional, non-validated extras the controller supplies for a signature (request-derived). */
export interface WaiverSignContext {
  /** Caller IP for the audit trail, or null when unavailable. */
  ip?: string | null;
  /** Object-storage key of the rendered signed document — storage adapter lands later, accept null. */
  documentStorageKey?: string | null;
}

export class WaiversService {
  constructor(
    private readonly templates: WaiverTemplateStore,
    private readonly signatures: WaiverSignatureStore,
  ) {}

  async createTemplate(
    actor: AuthzActor,
    input: WaiverTemplateCreateInput,
  ): Promise<WaiverTemplate> {
    if (!can(actor, { resource: 'waiver', action: 'create' }))
      throw new ForbiddenError('create', 'waiver');
    return this.templates.create(input);
  }

  async listTemplates(
    actor: AuthzActor,
    opts: { active?: boolean } = {},
  ): Promise<WaiverTemplate[]> {
    if (!can(actor, { resource: 'waiver', action: 'list' }))
      throw new ForbiddenError('list', 'waiver');
    return this.templates.list(opts);
  }

  async getTemplate(actor: AuthzActor, id: string): Promise<WaiverTemplate> {
    if (!can(actor, { resource: 'waiver', action: 'read' }))
      throw new ForbiddenError('read', 'waiver');
    const existing = await this.templates.findById(id);
    if (!existing) throw new NotFoundError('waiver', id);
    return existing;
  }

  /** Edit a template body/metadata — MINTS A NEW VERSION (the store bumps `version`). */
  async updateTemplate(
    actor: AuthzActor,
    id: string,
    patch: WaiverTemplateUpdateInput,
  ): Promise<WaiverTemplate> {
    if (!can(actor, { resource: 'waiver', action: 'update' }))
      throw new ForbiddenError('update', 'waiver');
    const existing = await this.templates.findById(id);
    if (!existing) throw new NotFoundError('waiver', id);
    const updated = await this.templates.updateBody(id, patch);
    if (!updated) throw new NotFoundError('waiver', id);
    return updated;
  }

  /**
   * Record a signature, PINNING THE CURRENT TEMPLATE VERSION. Who may sign:
   *  - the member themself (self-access: actor.memberId === input.memberId),
   *  - a guardian acting for the covered minor (guardianship grant on the member resource), or
   *  - staff with `waiver:create` recording on someone's behalf.
   * The pinned version is read from the template at sign time, so a later edit never alters it.
   */
  async sign(
    actor: AuthzActor,
    input: WaiverSignInput,
    context: WaiverSignContext = {},
  ): Promise<WaiverSignature> {
    const isSelf = actor.memberId !== undefined && actor.memberId === input.memberId;
    // Staff record via the catalog (waiver:create); the covered member / their guardian may sign
    // their own waiver via member self-access / guardianship over the member record.
    const canRecord = can(actor, { resource: 'waiver', action: 'create' });
    const canSelfOrGuardian =
      isSelf || can(actor, { resource: 'member', action: 'update', ownerMemberId: input.memberId });
    if (!canRecord && !canSelfOrGuardian) throw new ForbiddenError('create', 'waiver');

    const template = await this.templates.findById(input.templateId);
    if (!template) throw new NotFoundError('waiver', input.templateId);

    return this.signatures.create({
      templateId: template.id,
      templateVersion: template.version,
      memberId: input.memberId,
      signedByUserId: actor.userId ?? null,
      signedByName: input.signedByName,
      isGuardian: input.isGuardian,
      guardianForMemberId: input.guardianForMemberId ?? null,
      signedAt: new Date().toISOString(),
      ip: context.ip ?? null,
      documentStorageKey: context.documentStorageKey ?? null,
    });
  }

  async listSignatures(actor: AuthzActor, memberId: string): Promise<WaiverSignature[]> {
    // A member may list their OWN signatures (self-access); otherwise needs the waiver list grant.
    const isSelf = actor.memberId !== undefined && actor.memberId === memberId;
    if (!isSelf && !can(actor, { resource: 'waiver', action: 'list' }))
      throw new ForbiddenError('list', 'waiver');
    return this.signatures.listByMember(memberId);
  }
}
