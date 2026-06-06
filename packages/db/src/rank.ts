import type {
  CriterionEvaluation,
  Curriculum,
  CurriculumCompletion,
  CurriculumItem,
  Discipline,
  GradingEvent,
  GradingEventStatus,
  GradingResultRecord,
  MemberRankState,
  PresentationStyle,
  ProgressionSystem,
  ProgressionSystemVersion,
  Promotion,
  Step,
  Track,
  TransitionRule,
} from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Rank/grading/curriculum persistence (ADR-0005/0015). Every collection is tenant-guarded. Two
 * things are APPEND-ONLY by law: minted ProgressionSystemVersions (immutable; a change mints a new
 * version) and Promotions (immutable history that pins the version it was granted under, invariant
 * 5). A member's RankState is the only mutable rank record, advanced solely by recording a Promotion.
 * The canonical rank model lives in @obikai/domain; this layer only maps Mongoose docs ↔ those
 * shapes and never evaluates rules (that is @obikai/rank-engine).
 */

// ── Discipline ──────────────────────────────────────────────────────────────────
export interface DisciplineDoc extends TenantScoped {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  presentation: PresentationStyle;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const disciplineSchema = new Schema<DisciplineDoc>(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    presentation: { type: String, required: true, default: 'belt' },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);
disciplineSchema.plugin(tenantGuard);
disciplineSchema.index({ tenantId: 1, name: 1 });

export const DisciplineModel: Model<DisciplineDoc> =
  (mongoose.models.Discipline as Model<DisciplineDoc> | undefined) ??
  mongoose.model<DisciplineDoc>('Discipline', disciplineSchema);

export function toDiscipline(doc: DisciplineDoc): Discipline {
  return {
    id: doc._id.toString() as Discipline['id'],
    tenantId: doc.tenantId as Discipline['tenantId'],
    name: doc.name,
    description: doc.description ?? null,
    presentation: doc.presentation,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class DisciplineRepository {
  constructor(private readonly model: Model<DisciplineDoc> = DisciplineModel) {}

  async create(input: {
    name: string;
    description?: string | null;
    presentation?: PresentationStyle;
    active?: boolean;
  }): Promise<Discipline> {
    const created = await this.model.create({
      name: input.name,
      description: input.description ?? null,
      presentation: input.presentation ?? 'belt',
      active: input.active ?? true,
    });
    return toDiscipline(created.toObject() as unknown as DisciplineDoc);
  }

  async findById(id: string): Promise<Discipline | null> {
    const doc = await this.model.findById(id).lean<DisciplineDoc>().exec();
    return doc ? toDiscipline(doc) : null;
  }

  async list(opts: { active?: boolean } = {}): Promise<Discipline[]> {
    const filter = opts.active !== undefined ? { active: opts.active } : {};
    const docs = await this.model.find(filter).sort({ name: 1 }).lean<DisciplineDoc[]>().exec();
    return docs.map(toDiscipline);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      presentation?: PresentationStyle;
      active?: boolean;
    },
  ): Promise<Discipline | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { new: true })
      .lean<DisciplineDoc>()
      .exec();
    return doc ? toDiscipline(doc) : null;
  }
}

// ── ProgressionSystem (handle) + ProgressionSystemVersion (immutable) ─────────────
export interface ProgressionSystemDoc extends TenantScoped {
  _id: Types.ObjectId;
  systemId: string;
  disciplineId: string;
  currentVersionId: string;
  versionIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

const progressionSystemSchema = new Schema<ProgressionSystemDoc>(
  {
    // App-generated logical id (the domain SystemId), distinct from Mongo's _id.
    systemId: { type: String, required: true },
    disciplineId: { type: String, required: true },
    currentVersionId: { type: String, required: true },
    versionIds: { type: [String], required: true, default: [] },
  },
  { timestamps: true },
);
progressionSystemSchema.plugin(tenantGuard);
progressionSystemSchema.index({ tenantId: 1, systemId: 1 }, { unique: true });
// One progression system per discipline (a discipline has exactly one rank ladder).
progressionSystemSchema.index({ tenantId: 1, disciplineId: 1 }, { unique: true });

export const ProgressionSystemModel: Model<ProgressionSystemDoc> =
  (mongoose.models.ProgressionSystem as Model<ProgressionSystemDoc> | undefined) ??
  mongoose.model<ProgressionSystemDoc>('ProgressionSystem', progressionSystemSchema);

export interface ProgressionSystemVersionDoc extends TenantScoped {
  _id: Types.ObjectId;
  systemId: string;
  versionId: string;
  version: number;
  disciplineId: string;
  presentation: PresentationStyle;
  // Immutable nested config — interpreted only by the engine, so stored as opaque embedded data.
  tracks: Track[];
  ladder: Step[];
  transitions: TransitionRule[];
  curricula: Curriculum[];
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

const progressionSystemVersionSchema = new Schema<ProgressionSystemVersionDoc>(
  {
    systemId: { type: String, required: true },
    versionId: { type: String, required: true },
    version: { type: Number, required: true },
    disciplineId: { type: String, required: true },
    presentation: { type: String, required: true },
    tracks: { type: Schema.Types.Mixed, required: true },
    ladder: { type: Schema.Types.Mixed, required: true },
    transitions: { type: Schema.Types.Mixed, required: true },
    curricula: { type: Schema.Types.Mixed, required: true },
    contentHash: { type: String, required: true },
  },
  { timestamps: true },
);
progressionSystemVersionSchema.plugin(tenantGuard);
// A versionId is unique within a tenant; immutable once written.
progressionSystemVersionSchema.index({ tenantId: 1, versionId: 1 }, { unique: true });
progressionSystemVersionSchema.index({ tenantId: 1, systemId: 1, version: 1 });

export const ProgressionSystemVersionModel: Model<ProgressionSystemVersionDoc> =
  (mongoose.models.ProgressionSystemVersion as Model<ProgressionSystemVersionDoc> | undefined) ??
  mongoose.model<ProgressionSystemVersionDoc>(
    'ProgressionSystemVersion',
    progressionSystemVersionSchema,
  );

function toSystem(doc: ProgressionSystemDoc): ProgressionSystem {
  return {
    id: doc.systemId as ProgressionSystem['id'],
    disciplineId: doc.disciplineId as ProgressionSystem['disciplineId'],
    currentVersionId: doc.currentVersionId as ProgressionSystem['currentVersionId'],
    versionIds: doc.versionIds.map((v) => v as ProgressionSystem['versionIds'][number]),
  };
}

function toVersion(doc: ProgressionSystemVersionDoc): ProgressionSystemVersion {
  return {
    systemId: doc.systemId as ProgressionSystemVersion['systemId'],
    versionId: doc.versionId as ProgressionSystemVersion['versionId'],
    version: doc.version,
    disciplineId: doc.disciplineId as ProgressionSystemVersion['disciplineId'],
    presentation: doc.presentation,
    tracks: doc.tracks,
    ladder: doc.ladder,
    transitions: doc.transitions,
    curricula: doc.curricula,
    contentHash: doc.contentHash,
  };
}

/** Raised when publishing a version whose versionId already exists (immutability/idempotency). */
export class DuplicateVersionError extends Error {
  constructor(versionId: string) {
    super(`progression system version already exists: ${versionId}`);
    this.name = 'DuplicateVersionError';
  }
}

/**
 * Persists immutable progression-system versions and the mutable logical handle that points at the
 * current one. `publishVersion` inserts a version (append-only) and upserts the system handle:
 * appends the versionId and makes it current. There is intentionally NO version update/delete.
 */
export class RankSystemRepository {
  constructor(
    private readonly systems: Model<ProgressionSystemDoc> = ProgressionSystemModel,
    private readonly versions: Model<ProgressionSystemVersionDoc> = ProgressionSystemVersionModel,
  ) {}

  async publishVersion(version: ProgressionSystemVersion): Promise<ProgressionSystemVersion> {
    try {
      await this.versions.create({
        systemId: version.systemId,
        versionId: version.versionId,
        version: version.version,
        disciplineId: version.disciplineId,
        presentation: version.presentation,
        tracks: version.tracks,
        ladder: version.ladder,
        transitions: version.transitions,
        curricula: version.curricula,
        contentHash: version.contentHash,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new DuplicateVersionError(version.versionId);
      }
      throw err;
    }
    await this.systems.findOneAndUpdate(
      { systemId: String(version.systemId) },
      {
        $set: { currentVersionId: version.versionId, disciplineId: version.disciplineId },
        $setOnInsert: { systemId: version.systemId },
        $addToSet: { versionIds: version.versionId },
      },
      { upsert: true, new: true },
    );
    return version;
  }

  async getSystem(systemId: string): Promise<ProgressionSystem | null> {
    const doc = await this.systems
      .findOne({ systemId: String(systemId) })
      .lean<ProgressionSystemDoc>()
      .exec();
    return doc ? toSystem(doc) : null;
  }

  async findSystemByDiscipline(disciplineId: string): Promise<ProgressionSystem | null> {
    const doc = await this.systems
      .findOne({ disciplineId: String(disciplineId) })
      .lean<ProgressionSystemDoc>()
      .exec();
    return doc ? toSystem(doc) : null;
  }

  async getVersion(versionId: string): Promise<ProgressionSystemVersion | null> {
    const doc = await this.versions
      .findOne({ versionId: String(versionId) })
      .lean<ProgressionSystemVersionDoc>()
      .exec();
    return doc ? toVersion(doc) : null;
  }

  async getCurrentVersion(systemId: string): Promise<ProgressionSystemVersion | null> {
    const sys = await this.systems
      .findOne({ systemId: String(systemId) })
      .lean<ProgressionSystemDoc>()
      .exec();
    if (!sys) return null;
    const doc = await this.versions
      .findOne({ versionId: sys.currentVersionId })
      .lean<ProgressionSystemVersionDoc>()
      .exec();
    return doc ? toVersion(doc) : null;
  }

  async listVersions(systemId: string): Promise<ProgressionSystemVersion[]> {
    const docs = await this.versions
      .find({ systemId: String(systemId) })
      .sort({ version: 1 })
      .lean<ProgressionSystemVersionDoc[]>()
      .exec();
    return docs.map(toVersion);
  }
}

// ── MemberRankState (mutable current position) ────────────────────────────────────
export interface MemberRankStateDoc extends TenantScoped {
  _id: Types.ObjectId;
  memberId: string;
  disciplineId: string;
  systemId: string;
  trackId: string;
  currentStepId: string | null;
  enteredCurrentStepAt: string;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const memberRankStateSchema = new Schema<MemberRankStateDoc>(
  {
    memberId: { type: String, required: true },
    disciplineId: { type: String, required: true },
    systemId: { type: String, required: true },
    trackId: { type: String, required: true },
    currentStepId: { type: String, default: null },
    enteredCurrentStepAt: { type: String, required: true },
    archived: { type: Boolean, required: true, default: false },
  },
  { timestamps: true },
);
memberRankStateSchema.plugin(tenantGuard);
// Exactly one rank state per (member, discipline) within a tenant.
memberRankStateSchema.index({ tenantId: 1, memberId: 1, disciplineId: 1 }, { unique: true });

export const MemberRankStateModel: Model<MemberRankStateDoc> =
  (mongoose.models.MemberRankState as Model<MemberRankStateDoc> | undefined) ??
  mongoose.model<MemberRankStateDoc>('MemberRankState', memberRankStateSchema);

export function toMemberRankState(doc: MemberRankStateDoc): MemberRankState {
  return {
    id: doc._id.toString() as MemberRankState['id'],
    tenantId: doc.tenantId as MemberRankState['tenantId'],
    memberId: doc.memberId as MemberRankState['memberId'],
    disciplineId: doc.disciplineId as MemberRankState['disciplineId'],
    systemId: doc.systemId as MemberRankState['systemId'],
    trackId: doc.trackId as MemberRankState['trackId'],
    currentStepId: (doc.currentStepId as MemberRankState['currentStepId']) ?? null,
    enteredCurrentStepAt: doc.enteredCurrentStepAt,
    archived: doc.archived,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class MemberRankStateRepository {
  constructor(private readonly model: Model<MemberRankStateDoc> = MemberRankStateModel) {}

  async create(input: {
    memberId: string;
    disciplineId: string;
    systemId: string;
    trackId: string;
    currentStepId?: string | null;
    enteredCurrentStepAt: string;
  }): Promise<MemberRankState> {
    const created = await this.model.create({
      memberId: input.memberId,
      disciplineId: input.disciplineId,
      systemId: input.systemId,
      trackId: input.trackId,
      currentStepId: input.currentStepId ?? null,
      enteredCurrentStepAt: input.enteredCurrentStepAt,
    });
    return toMemberRankState(created.toObject() as unknown as MemberRankStateDoc);
  }

  async findById(id: string): Promise<MemberRankState | null> {
    const doc = await this.model.findById(id).lean<MemberRankStateDoc>().exec();
    return doc ? toMemberRankState(doc) : null;
  }

  async findByMemberDiscipline(
    memberId: string,
    disciplineId: string,
  ): Promise<MemberRankState | null> {
    const doc = await this.model
      .findOne({ memberId: String(memberId), disciplineId: String(disciplineId) })
      .lean<MemberRankStateDoc>()
      .exec();
    return doc ? toMemberRankState(doc) : null;
  }

  async list(opts: { memberId?: string; disciplineId?: string } = {}): Promise<MemberRankState[]> {
    const filter: Record<string, unknown> = {};
    if (opts.memberId) filter.memberId = String(opts.memberId);
    if (opts.disciplineId) filter.disciplineId = String(opts.disciplineId);
    const docs = await this.model.find(filter).lean<MemberRankStateDoc[]>().exec();
    return docs.map(toMemberRankState);
  }

  /** Advance (or otherwise update) a member's position. Used when recording a promotion. */
  async update(
    id: string,
    patch: {
      currentStepId?: string | null;
      trackId?: string;
      enteredCurrentStepAt?: string;
      archived?: boolean;
    },
  ): Promise<MemberRankState | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { new: true })
      .lean<MemberRankStateDoc>()
      .exec();
    return doc ? toMemberRankState(doc) : null;
  }
}

// ── Promotion (append-only history) ───────────────────────────────────────────────
export interface PromotionDoc extends TenantScoped {
  _id: Types.ObjectId;
  memberId: string;
  disciplineId: string;
  systemId: string;
  systemVersionId: string;
  fromStepId: string | null;
  toStepId: string;
  awardedAt: string;
  awardedByRole: 'instructor' | 'owner';
  awardingUserId: string;
  satisfiedSnapshot: CriterionEvaluation[];
  overrideReason: string | null;
  createdAt: Date;
}

const promotionSchema = new Schema<PromotionDoc>(
  {
    memberId: { type: String, required: true },
    disciplineId: { type: String, required: true },
    systemId: { type: String, required: true },
    systemVersionId: { type: String, required: true },
    fromStepId: { type: String, default: null },
    toStepId: { type: String, required: true },
    awardedAt: { type: String, required: true },
    awardedByRole: { type: String, required: true },
    awardingUserId: { type: String, required: true },
    satisfiedSnapshot: { type: Schema.Types.Mixed, required: true },
    overrideReason: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
promotionSchema.plugin(tenantGuard);
promotionSchema.index({ tenantId: 1, memberId: 1, disciplineId: 1, awardedAt: -1 });

export const PromotionModel: Model<PromotionDoc> =
  (mongoose.models.Promotion as Model<PromotionDoc> | undefined) ??
  mongoose.model<PromotionDoc>('Promotion', promotionSchema);

export function toPromotion(doc: PromotionDoc): Promotion {
  return {
    id: doc._id.toString() as Promotion['id'],
    tenantId: doc.tenantId as Promotion['tenantId'],
    memberId: doc.memberId as Promotion['memberId'],
    disciplineId: doc.disciplineId as Promotion['disciplineId'],
    systemId: doc.systemId as Promotion['systemId'],
    systemVersionId: doc.systemVersionId as Promotion['systemVersionId'],
    fromStepId: (doc.fromStepId as Promotion['fromStepId']) ?? null,
    toStepId: doc.toStepId as Promotion['toStepId'],
    awardedAt: doc.awardedAt,
    awardedByRole: doc.awardedByRole,
    awardingUserId: doc.awardingUserId,
    satisfiedSnapshot: doc.satisfiedSnapshot,
    overrideReason: doc.overrideReason ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Append-only promotion history (invariant 5). No update/delete by design. */
export class PromotionRepository {
  constructor(private readonly model: Model<PromotionDoc> = PromotionModel) {}

  async create(input: {
    memberId: string;
    disciplineId: string;
    systemId: string;
    systemVersionId: string;
    fromStepId: string | null;
    toStepId: string;
    awardedAt: string;
    awardedByRole: 'instructor' | 'owner';
    awardingUserId: string;
    satisfiedSnapshot: readonly CriterionEvaluation[];
    overrideReason?: string | null;
  }): Promise<Promotion> {
    const created = await this.model.create({
      memberId: input.memberId,
      disciplineId: input.disciplineId,
      systemId: input.systemId,
      systemVersionId: input.systemVersionId,
      fromStepId: input.fromStepId,
      toStepId: input.toStepId,
      awardedAt: input.awardedAt,
      awardedByRole: input.awardedByRole,
      awardingUserId: input.awardingUserId,
      satisfiedSnapshot: input.satisfiedSnapshot as CriterionEvaluation[],
      overrideReason: input.overrideReason ?? null,
    });
    return toPromotion(created.toObject() as unknown as PromotionDoc);
  }

  async findById(id: string): Promise<Promotion | null> {
    const doc = await this.model.findById(id).lean<PromotionDoc>().exec();
    return doc ? toPromotion(doc) : null;
  }

  async list(opts: { memberId?: string; disciplineId?: string } = {}): Promise<Promotion[]> {
    const filter: Record<string, unknown> = {};
    if (opts.memberId) filter.memberId = String(opts.memberId);
    if (opts.disciplineId) filter.disciplineId = String(opts.disciplineId);
    const docs = await this.model
      .find(filter)
      .sort({ awardedAt: -1 })
      .lean<PromotionDoc[]>()
      .exec();
    return docs.map(toPromotion);
  }
}

// ── GradingEvent + GradingResult ──────────────────────────────────────────────────
export interface GradingEventDoc extends TenantScoped {
  _id: Types.ObjectId;
  disciplineId: string;
  name: string;
  scheduledAt: string;
  locationId: string | null;
  status: GradingEventStatus;
  createdAt: Date;
  updatedAt: Date;
}

const gradingEventSchema = new Schema<GradingEventDoc>(
  {
    disciplineId: { type: String, required: true },
    name: { type: String, required: true },
    scheduledAt: { type: String, required: true },
    locationId: { type: String, default: null },
    status: { type: String, required: true, default: 'scheduled' },
  },
  { timestamps: true },
);
gradingEventSchema.plugin(tenantGuard);
gradingEventSchema.index({ tenantId: 1, disciplineId: 1, scheduledAt: -1 });

export const GradingEventModel: Model<GradingEventDoc> =
  (mongoose.models.GradingEvent as Model<GradingEventDoc> | undefined) ??
  mongoose.model<GradingEventDoc>('GradingEvent', gradingEventSchema);

export function toGradingEvent(doc: GradingEventDoc): GradingEvent {
  return {
    id: doc._id.toString() as GradingEvent['id'],
    tenantId: doc.tenantId as GradingEvent['tenantId'],
    disciplineId: doc.disciplineId as GradingEvent['disciplineId'],
    name: doc.name,
    scheduledAt: doc.scheduledAt,
    locationId: doc.locationId ?? null,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class GradingEventRepository {
  constructor(private readonly model: Model<GradingEventDoc> = GradingEventModel) {}

  async create(input: {
    disciplineId: string;
    name: string;
    scheduledAt: string;
    locationId?: string | null;
  }): Promise<GradingEvent> {
    const created = await this.model.create({
      disciplineId: input.disciplineId,
      name: input.name,
      scheduledAt: input.scheduledAt,
      locationId: input.locationId ?? null,
    });
    return toGradingEvent(created.toObject() as unknown as GradingEventDoc);
  }

  async findById(id: string): Promise<GradingEvent | null> {
    const doc = await this.model.findById(id).lean<GradingEventDoc>().exec();
    return doc ? toGradingEvent(doc) : null;
  }

  async list(opts: { disciplineId?: string } = {}): Promise<GradingEvent[]> {
    const filter = opts.disciplineId ? { disciplineId: String(opts.disciplineId) } : {};
    const docs = await this.model
      .find(filter)
      .sort({ scheduledAt: -1 })
      .lean<GradingEventDoc[]>()
      .exec();
    return docs.map(toGradingEvent);
  }

  async update(
    id: string,
    patch: {
      name?: string;
      scheduledAt?: string;
      locationId?: string | null;
      status?: GradingEventStatus;
    },
  ): Promise<GradingEvent | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { new: true })
      .lean<GradingEventDoc>()
      .exec();
    return doc ? toGradingEvent(doc) : null;
  }
}

export interface GradingResultDoc extends TenantScoped {
  _id: Types.ObjectId;
  gradingEventId: string;
  memberId: string;
  stepId: string;
  passed: boolean;
  recordedByUserId: string;
  recordedAt: string;
  notes: string | null;
}

const gradingResultSchema = new Schema<GradingResultDoc>(
  {
    gradingEventId: { type: String, required: true },
    memberId: { type: String, required: true },
    stepId: { type: String, required: true },
    passed: { type: Boolean, required: true },
    recordedByUserId: { type: String, required: true },
    recordedAt: { type: String, required: true },
    notes: { type: String, default: null },
  },
  { timestamps: false },
);
gradingResultSchema.plugin(tenantGuard);
// One result per (event, member, step); re-recording overwrites via upsert at the repo layer.
gradingResultSchema.index(
  { tenantId: 1, gradingEventId: 1, memberId: 1, stepId: 1 },
  { unique: true },
);
gradingResultSchema.index({ tenantId: 1, memberId: 1 });

export const GradingResultModel: Model<GradingResultDoc> =
  (mongoose.models.GradingResult as Model<GradingResultDoc> | undefined) ??
  mongoose.model<GradingResultDoc>('GradingResult', gradingResultSchema);

export function toGradingResult(doc: GradingResultDoc): GradingResultRecord {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId as GradingResultRecord['tenantId'],
    gradingEventId: doc.gradingEventId as GradingResultRecord['gradingEventId'],
    memberId: doc.memberId as GradingResultRecord['memberId'],
    stepId: doc.stepId as GradingResultRecord['stepId'],
    passed: doc.passed,
    recordedByUserId: doc.recordedByUserId,
    recordedAt: doc.recordedAt,
    notes: doc.notes ?? null,
  };
}

export class GradingResultRepository {
  constructor(private readonly model: Model<GradingResultDoc> = GradingResultModel) {}

  /** Record (or overwrite) a member's result for a step at an event — idempotent per the index. */
  async record(input: {
    gradingEventId: string;
    memberId: string;
    stepId: string;
    passed: boolean;
    recordedByUserId: string;
    recordedAt: string;
    notes?: string | null;
  }): Promise<GradingResultRecord> {
    const doc = await this.model
      .findOneAndUpdate(
        {
          gradingEventId: String(input.gradingEventId),
          memberId: String(input.memberId),
          stepId: String(input.stepId),
        },
        {
          $set: {
            passed: input.passed,
            recordedByUserId: input.recordedByUserId,
            recordedAt: input.recordedAt,
            notes: input.notes ?? null,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<GradingResultDoc>()
      .exec();
    if (!doc) throw new Error('failed to record grading result');
    return toGradingResult(doc);
  }

  async listByEvent(gradingEventId: string): Promise<GradingResultRecord[]> {
    const docs = await this.model
      .find({ gradingEventId: String(gradingEventId) })
      .lean<GradingResultDoc[]>()
      .exec();
    return docs.map(toGradingResult);
  }

  async listByMember(memberId: string): Promise<GradingResultRecord[]> {
    const docs = await this.model
      .find({ memberId: String(memberId) })
      .lean<GradingResultDoc[]>()
      .exec();
    return docs.map(toGradingResult);
  }
}

// ── CurriculumItem (content) + CurriculumCompletion (per-student) ──────────────────
export interface CurriculumItemDoc extends TenantScoped {
  _id: Types.ObjectId;
  disciplineId: string;
  itemKey: string;
  label: string;
  description: string | null;
  mediaRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const curriculumItemSchema = new Schema<CurriculumItemDoc>(
  {
    disciplineId: { type: String, required: true },
    itemKey: { type: String, required: true },
    label: { type: String, required: true },
    description: { type: String, default: null },
    mediaRef: { type: String, default: null },
  },
  { timestamps: true },
);
curriculumItemSchema.plugin(tenantGuard);
// itemKey is the engine-facing id and must be unique per discipline within a tenant.
curriculumItemSchema.index({ tenantId: 1, disciplineId: 1, itemKey: 1 }, { unique: true });

export const CurriculumItemModel: Model<CurriculumItemDoc> =
  (mongoose.models.CurriculumItem as Model<CurriculumItemDoc> | undefined) ??
  mongoose.model<CurriculumItemDoc>('CurriculumItem', curriculumItemSchema);

export function toCurriculumItem(doc: CurriculumItemDoc): CurriculumItem {
  return {
    id: doc._id.toString() as CurriculumItem['id'],
    tenantId: doc.tenantId as CurriculumItem['tenantId'],
    disciplineId: doc.disciplineId as CurriculumItem['disciplineId'],
    itemKey: doc.itemKey,
    label: doc.label,
    description: doc.description ?? null,
    mediaRef: doc.mediaRef ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class CurriculumItemRepository {
  constructor(private readonly model: Model<CurriculumItemDoc> = CurriculumItemModel) {}

  async create(input: {
    disciplineId: string;
    itemKey: string;
    label: string;
    description?: string | null;
    mediaRef?: string | null;
  }): Promise<CurriculumItem> {
    const created = await this.model.create({
      disciplineId: input.disciplineId,
      itemKey: input.itemKey,
      label: input.label,
      description: input.description ?? null,
      mediaRef: input.mediaRef ?? null,
    });
    return toCurriculumItem(created.toObject() as unknown as CurriculumItemDoc);
  }

  async findById(id: string): Promise<CurriculumItem | null> {
    const doc = await this.model.findById(id).lean<CurriculumItemDoc>().exec();
    return doc ? toCurriculumItem(doc) : null;
  }

  async list(opts: { disciplineId?: string } = {}): Promise<CurriculumItem[]> {
    const filter = opts.disciplineId ? { disciplineId: String(opts.disciplineId) } : {};
    const docs = await this.model
      .find(filter)
      .sort({ itemKey: 1 })
      .lean<CurriculumItemDoc[]>()
      .exec();
    return docs.map(toCurriculumItem);
  }

  async update(
    id: string,
    patch: { label?: string; description?: string | null; mediaRef?: string | null },
  ): Promise<CurriculumItem | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { new: true })
      .lean<CurriculumItemDoc>()
      .exec();
    return doc ? toCurriculumItem(doc) : null;
  }
}

export interface CurriculumCompletionDoc extends TenantScoped {
  _id: Types.ObjectId;
  memberId: string;
  disciplineId: string;
  itemKey: string;
  completedAt: string;
  markedByUserId: string;
}

const curriculumCompletionSchema = new Schema<CurriculumCompletionDoc>(
  {
    memberId: { type: String, required: true },
    disciplineId: { type: String, required: true },
    itemKey: { type: String, required: true },
    completedAt: { type: String, required: true },
    markedByUserId: { type: String, required: true },
  },
  { timestamps: false },
);
curriculumCompletionSchema.plugin(tenantGuard);
// A student completes an item at most once per discipline (idempotent mark).
curriculumCompletionSchema.index(
  { tenantId: 1, memberId: 1, disciplineId: 1, itemKey: 1 },
  { unique: true },
);

export const CurriculumCompletionModel: Model<CurriculumCompletionDoc> =
  (mongoose.models.CurriculumCompletion as Model<CurriculumCompletionDoc> | undefined) ??
  mongoose.model<CurriculumCompletionDoc>('CurriculumCompletion', curriculumCompletionSchema);

export function toCurriculumCompletion(doc: CurriculumCompletionDoc): CurriculumCompletion {
  return {
    id: doc._id.toString() as CurriculumCompletion['id'],
    tenantId: doc.tenantId as CurriculumCompletion['tenantId'],
    memberId: doc.memberId as CurriculumCompletion['memberId'],
    disciplineId: doc.disciplineId as CurriculumCompletion['disciplineId'],
    itemKey: doc.itemKey,
    completedAt: doc.completedAt,
    markedByUserId: doc.markedByUserId,
  };
}

export class CurriculumCompletionRepository {
  constructor(private readonly model: Model<CurriculumCompletionDoc> = CurriculumCompletionModel) {}

  /** Mark an item complete (idempotent — re-marking refreshes who/when). */
  async mark(input: {
    memberId: string;
    disciplineId: string;
    itemKey: string;
    completedAt: string;
    markedByUserId: string;
  }): Promise<CurriculumCompletion> {
    const doc = await this.model
      .findOneAndUpdate(
        {
          memberId: String(input.memberId),
          disciplineId: String(input.disciplineId),
          itemKey: String(input.itemKey),
        },
        { $set: { completedAt: input.completedAt, markedByUserId: input.markedByUserId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<CurriculumCompletionDoc>()
      .exec();
    if (!doc) throw new Error('failed to mark curriculum completion');
    return toCurriculumCompletion(doc);
  }

  async unmark(memberId: string, disciplineId: string, itemKey: string): Promise<boolean> {
    const res = await this.model
      .deleteOne({
        memberId: String(memberId),
        disciplineId: String(disciplineId),
        itemKey: String(itemKey),
      })
      .exec();
    return (res.deletedCount ?? 0) > 0;
  }

  async listByMemberDiscipline(
    memberId: string,
    disciplineId: string,
  ): Promise<CurriculumCompletion[]> {
    const docs = await this.model
      .find({ memberId: String(memberId), disciplineId: String(disciplineId) })
      .lean<CurriculumCompletionDoc[]>()
      .exec();
    return docs.map(toCurriculumCompletion);
  }
}
