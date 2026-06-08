import { randomUUID } from 'node:crypto';
import type { StoragePort } from '@obikai/adapter-contracts';
import { type AuthzActor, can } from '@obikai/authz';
import type {
  MemberWaiverStatus,
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
  /** Object-storage key of the uploaded signed document (from `createDocumentUploadUrl`), or null. */
  documentStorageKey?: string | null;
  /** The resolved request tenant — required to validate `documentStorageKey` stays in-namespace. */
  tenantId?: string;
}

/** The object-storage key prefix all of a tenant's waiver documents live under (ADR-0019). A signed
 *  document key MUST be inside this namespace, so one tenant can never reference another's object. */
export function waiverDocumentPrefix(tenantId: string): string {
  return `waivers/${tenantId}/`;
}

/** Allow only a short, safe file extension; anything else falls back to `pdf` (the usual case). */
export function safeDocumentExt(ext: string): string {
  const lower = ext.trim().toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(lower) ? lower : 'pdf';
}

export class WaiversService {
  constructor(
    private readonly templates: WaiverTemplateStore,
    private readonly signatures: WaiverSignatureStore,
    private readonly storage: StoragePort,
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

    // A client-supplied document key must live in THIS tenant's namespace — otherwise a signature
    // could later hand out a presigned URL to another tenant's object (cross-tenant read).
    const documentStorageKey = context.documentStorageKey ?? null;
    if (documentStorageKey !== null) {
      if (
        !context.tenantId ||
        !documentStorageKey.startsWith(waiverDocumentPrefix(context.tenantId))
      ) {
        throw new ForbiddenError('create', 'waiver');
      }
    }

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
      documentStorageKey,
    });
  }

  async listSignatures(actor: AuthzActor, memberId: string): Promise<WaiverSignature[]> {
    // A member may list their OWN signatures (self-access); otherwise needs the waiver list grant.
    const isSelf = actor.memberId !== undefined && actor.memberId === memberId;
    if (!isSelf && !can(actor, { resource: 'waiver', action: 'list' }))
      throw new ForbiddenError('list', 'waiver');
    return this.signatures.listByMember(memberId);
  }

  /**
   * The member-portal view: each ACTIVE template plus whether `memberId` has signed its CURRENT
   * version. This is what lets a member discover what they still need to sign WITHOUT the staff
   * `waiver:list` grant — visible to the covered member (self), their guardian (member-update grant),
   * or staff (`waiver:list`). A signature pinned to an older version counts as unsigned, so a revised
   * waiver re-prompts the member.
   */
  async listForMember(actor: AuthzActor, memberId: string): Promise<MemberWaiverStatus[]> {
    const isSelf = actor.memberId !== undefined && actor.memberId === memberId;
    const canSelfOrGuardian =
      isSelf || can(actor, { resource: 'member', action: 'update', ownerMemberId: memberId });
    if (!canSelfOrGuardian && !can(actor, { resource: 'waiver', action: 'list' }))
      throw new ForbiddenError('list', 'waiver');

    const [templates, signatures] = await Promise.all([
      this.templates.list({ active: true }),
      this.signatures.listByMember(memberId),
    ]);
    return templates.map((template) => {
      // Match only the template's CURRENT version; pick the most recent matching signature.
      const signature =
        signatures
          .filter((s) => s.templateId === template.id && s.templateVersion === template.version)
          .sort((a, b) => b.signedAt.localeCompare(a.signedAt))[0] ?? null;
      return { template, signed: signature !== null, signature };
    });
  }

  /**
   * Allocate a presigned PUT URL for a (not-yet-signed) waiver document, keyed under THIS tenant's
   * namespace. The client uploads the bytes to the URL, then passes the returned `key` to `sign`.
   * Anyone who could sign may stage a document: staff (`waiver:create`) or any member (for self).
   */
  async createDocumentUploadUrl(
    actor: AuthzActor,
    tenantId: string,
    input: { contentType: string; ext: string },
  ): Promise<{ key: string; url: string; headers?: Record<string, string> }> {
    const canRecord = can(actor, { resource: 'waiver', action: 'create' });
    if (!canRecord && actor.memberId === undefined) throw new ForbiddenError('create', 'waiver');
    const key = `${waiverDocumentPrefix(tenantId)}${randomUUID()}.${safeDocumentExt(input.ext)}`;
    const { url, headers } = await this.storage.presignPut({ key, contentType: input.contentType });
    return headers ? { key, url, headers } : { key, url };
  }

  /**
   * Presigned GET URL for a signature's stored document. Visible to the covered member (self), their
   * guardian (member-update grant), or staff (`waiver:read`/`list`). 404 if no document is attached.
   */
  async getDocumentDownloadUrl(actor: AuthzActor, id: string): Promise<{ url: string }> {
    const signature = await this.signatures.findById(id);
    if (!signature) throw new NotFoundError('waiver signature', id);
    const isSelf = actor.memberId !== undefined && actor.memberId === signature.memberId;
    const canRead =
      can(actor, { resource: 'waiver', action: 'read' }) ||
      can(actor, { resource: 'waiver', action: 'list' });
    const canSelfOrGuardian =
      isSelf ||
      can(actor, { resource: 'member', action: 'update', ownerMemberId: signature.memberId });
    if (!canRead && !canSelfOrGuardian) throw new ForbiddenError('read', 'waiver');
    if (!signature.documentStorageKey) throw new NotFoundError('waiver document', id);
    return this.storage.presignGet({ key: signature.documentStorageKey });
  }
}
