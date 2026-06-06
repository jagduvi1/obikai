import type { WaiverSignature, WaiverTemplate, WaiverTemplateCreateInput } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Digital-waiver persistence (ADR-0014, scope §4.10). Two collections:
 *
 *  - `WaiverTemplate` is VERSIONED — editing the body never rewrites history, it MINTS A NEW VERSION
 *    (`updateBody` bumps `version`), so a later edit can't change what a member already agreed to.
 *  - `WaiverSignature` is IMMUTABLE — it pins the exact `templateVersion` it was signed under and is
 *    timestamped. Minors are signed for by a guardian (`isGuardian` + `guardianForMemberId`).
 *
 * Both are tenant-owned, so `tenantGuard` scopes every query/write to the active tenant (ADR-0004);
 * this layer only maps between Mongoose docs and the `@obikai/domain` shapes.
 */
export interface WaiverTemplateDoc extends TenantScoped {
  _id: Types.ObjectId;
  title: string;
  bodyMarkdown: string;
  version: number;
  requiresGuardianForMinor: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface WaiverSignatureDoc extends TenantScoped {
  _id: Types.ObjectId;
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
  createdAt: Date;
}

const waiverTemplateSchema = new Schema<WaiverTemplateDoc>(
  {
    title: { type: String, required: true },
    bodyMarkdown: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    requiresGuardianForMinor: { type: Boolean, required: true, default: true },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

waiverTemplateSchema.plugin(tenantGuard);
// Hot list query: active templates within a tenant.
waiverTemplateSchema.index({ tenantId: 1, active: 1 });

const waiverSignatureSchema = new Schema<WaiverSignatureDoc>(
  {
    templateId: { type: String, required: true },
    templateVersion: { type: Number, required: true },
    memberId: { type: String, required: true },
    signedByUserId: { type: String, default: null },
    signedByName: { type: String, required: true },
    isGuardian: { type: Boolean, required: true, default: false },
    guardianForMemberId: { type: String, default: null },
    signedAt: { type: String, required: true },
    ip: { type: String, default: null },
    documentStorageKey: { type: String, default: null },
  },
  // Signatures are immutable: stamp createdAt, never updatedAt (no later mutation is allowed).
  { timestamps: { createdAt: true, updatedAt: false } },
);

waiverSignatureSchema.plugin(tenantGuard);
// Hot queries: a member's signatures, and every signature for a template.
waiverSignatureSchema.index({ tenantId: 1, memberId: 1 });
waiverSignatureSchema.index({ tenantId: 1, templateId: 1 });

export const WaiverTemplateModel: Model<WaiverTemplateDoc> =
  (mongoose.models.WaiverTemplate as Model<WaiverTemplateDoc> | undefined) ??
  mongoose.model<WaiverTemplateDoc>('WaiverTemplate', waiverTemplateSchema);

export const WaiverSignatureModel: Model<WaiverSignatureDoc> =
  (mongoose.models.WaiverSignature as Model<WaiverSignatureDoc> | undefined) ??
  mongoose.model<WaiverSignatureDoc>('WaiverSignature', waiverSignatureSchema);

export function toWaiverTemplate(doc: WaiverTemplateDoc): WaiverTemplate {
  return {
    id: doc._id.toString() as WaiverTemplate['id'],
    tenantId: doc.tenantId as WaiverTemplate['tenantId'],
    title: doc.title,
    bodyMarkdown: doc.bodyMarkdown,
    version: doc.version,
    requiresGuardianForMinor: doc.requiresGuardianForMinor,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toWaiverSignature(doc: WaiverSignatureDoc): WaiverSignature {
  return {
    id: doc._id.toString() as WaiverSignature['id'],
    tenantId: doc.tenantId as WaiverSignature['tenantId'],
    templateId: doc.templateId as WaiverSignature['templateId'],
    templateVersion: doc.templateVersion,
    memberId: doc.memberId as WaiverSignature['memberId'],
    signedByUserId: doc.signedByUserId,
    signedByName: doc.signedByName,
    isGuardian: doc.isGuardian,
    guardianForMemberId:
      (doc.guardianForMemberId as WaiverSignature['guardianForMemberId']) ?? null,
    signedAt: doc.signedAt,
    ip: doc.ip,
    documentStorageKey: doc.documentStorageKey,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** What may be patched on a template body edit; non-body fields update in place (no version bump). */
export interface WaiverTemplateBodyPatch {
  title?: string;
  bodyMarkdown?: string;
  requiresGuardianForMinor?: boolean;
  active?: boolean;
}

/**
 * Tenant-scoped WaiverTemplate repository. Every method runs through the guarded model, so it
 * requires an active TenantContext (ADR-0004) — calling it with no context throws rather than
 * leaking.
 */
export class WaiverTemplateRepository {
  constructor(private readonly model: Model<WaiverTemplateDoc> = WaiverTemplateModel) {}

  async create(input: WaiverTemplateCreateInput): Promise<WaiverTemplate> {
    const created = await this.model.create({
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      version: 1,
      requiresGuardianForMinor: input.requiresGuardianForMinor,
      active: input.active,
    });
    return toWaiverTemplate(created.toObject() as unknown as WaiverTemplateDoc);
  }

  async findById(id: string): Promise<WaiverTemplate | null> {
    const doc = await this.model.findById(id).lean<WaiverTemplateDoc>().exec();
    return doc ? toWaiverTemplate(doc) : null;
  }

  async list(opts: { active?: boolean } = {}): Promise<WaiverTemplate[]> {
    const filter = opts.active === undefined ? {} : { active: opts.active };
    const docs = await this.model
      .find(filter)
      .sort({ title: 1 })
      .lean<WaiverTemplateDoc[]>()
      .exec();
    return docs.map(toWaiverTemplate);
  }

  /**
   * Edit a template, MINTING A NEW VERSION: `$inc` the version atomically while applying the patch.
   * Existing signatures pinned the old version, so they are untouched (ADR-0014). Non-body metadata
   * (active/requiresGuardianForMinor/title) rides along on the same bump for a single coherent edit.
   */
  async updateBody(id: string, patch: WaiverTemplateBodyPatch): Promise<WaiverTemplate | null> {
    const set: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) set[key] = value;
    }
    const update =
      Object.keys(set).length > 0 ? { $set: set, $inc: { version: 1 } } : { $inc: { version: 1 } };
    const doc = await this.model
      .findByIdAndUpdate(id, update, { new: true })
      .lean<WaiverTemplateDoc>()
      .exec();
    return doc ? toWaiverTemplate(doc) : null;
  }
}

/** What the signature repo needs to persist one immutable, version-pinned signature. */
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

/**
 * Tenant-scoped WaiverSignature repository. Signatures are immutable: the repo exposes create/read
 * only — never update/delete. Every method requires an active TenantContext (ADR-0004).
 */
export class WaiverSignatureRepository {
  constructor(private readonly model: Model<WaiverSignatureDoc> = WaiverSignatureModel) {}

  async create(input: WaiverSignatureCreateFields): Promise<WaiverSignature> {
    const created = await this.model.create({
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      memberId: input.memberId,
      signedByUserId: input.signedByUserId,
      signedByName: input.signedByName,
      isGuardian: input.isGuardian,
      guardianForMemberId: input.guardianForMemberId,
      signedAt: input.signedAt,
      ip: input.ip,
      documentStorageKey: input.documentStorageKey,
    });
    return toWaiverSignature(created.toObject() as unknown as WaiverSignatureDoc);
  }

  async findById(id: string): Promise<WaiverSignature | null> {
    const doc = await this.model.findById(id).lean<WaiverSignatureDoc>().exec();
    return doc ? toWaiverSignature(doc) : null;
  }

  async listByMember(memberId: string): Promise<WaiverSignature[]> {
    const docs = await this.model
      .find({ memberId })
      .sort({ signedAt: -1 })
      .lean<WaiverSignatureDoc[]>()
      .exec();
    return docs.map(toWaiverSignature);
  }

  async listByTemplate(templateId: string): Promise<WaiverSignature[]> {
    const docs = await this.model
      .find({ templateId })
      .sort({ signedAt: -1 })
      .lean<WaiverSignatureDoc[]>()
      .exec();
    return docs.map(toWaiverSignature);
  }
}
