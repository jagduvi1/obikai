import type { Member, MemberCreateInput, MemberStatus, MemberUpdateInput } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Member persistence (ADR-0011). The `tenantGuard` plugin scopes every query/write to the active
 * tenant; this layer only maps between Mongoose docs and the `@obikai/domain` Member shape. Email
 * uniqueness is PER TENANT (`{tenantId, emailLower}`, partial) — two dojos may share an email, one
 * dojo may not duplicate it (ADR-0004 compound-unique).
 */
export interface MemberDoc extends TenantScoped {
  _id: Types.ObjectId;
  userId: string | null;
  householdId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  emailLower: string | null;
  phone: string | null;
  dateOfBirth: string | null;
  status: MemberStatus;
  joinDate: string | null;
  emergencyContact: { name: string; phone: string; relation: string | null } | null;
  notes: string | null;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}

const emergencyContactSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    relation: { type: String, default: null },
  },
  { _id: false },
);

const memberSchema = new Schema<MemberDoc>(
  {
    userId: { type: String, default: null },
    householdId: { type: String, default: null },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, default: null },
    emailLower: { type: String, default: null },
    phone: { type: String, default: null },
    dateOfBirth: { type: String, default: null },
    status: { type: String, required: true, default: 'lead' },
    joinDate: { type: String, default: null },
    emergencyContact: { type: emergencyContactSchema, default: null },
    notes: { type: String, default: null },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

memberSchema.plugin(tenantGuard);
// Per-tenant unique email (only when present): partial index so null emails never collide.
memberSchema.index(
  { tenantId: 1, emailLower: 1 },
  { unique: true, partialFilterExpression: { emailLower: { $type: 'string' } } },
);
// Hot list query: members by status, alphabetical.
memberSchema.index({ tenantId: 1, status: 1, lastName: 1 });
// Segment query: members carrying a tag (multikey index on the array).
memberSchema.index({ tenantId: 1, tags: 1 });

export const MemberModel: Model<MemberDoc> =
  (mongoose.models.Member as Model<MemberDoc> | undefined) ??
  mongoose.model<MemberDoc>('Member', memberSchema);

export function toMember(doc: MemberDoc): Member {
  return {
    id: doc._id.toString() as Member['id'],
    tenantId: doc.tenantId as Member['tenantId'],
    userId: (doc.userId as Member['userId']) ?? null,
    householdId: (doc.householdId as Member['householdId']) ?? null,
    firstName: doc.firstName,
    lastName: doc.lastName,
    email: doc.email,
    phone: doc.phone,
    dateOfBirth: doc.dateOfBirth,
    status: doc.status,
    joinDate: doc.joinDate,
    emergencyContact: doc.emergencyContact,
    notes: doc.notes,
    tags: doc.tags ?? [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function fields(input: MemberCreateInput): Record<string, unknown> {
  const email = input.email ?? null;
  return {
    householdId: input.householdId ?? null,
    firstName: input.firstName,
    lastName: input.lastName,
    email,
    emailLower: email ? email.toLowerCase() : null,
    phone: input.phone ?? null,
    dateOfBirth: input.dateOfBirth ?? null,
    status: input.status,
    joinDate: input.joinDate ?? null,
    emergencyContact: input.emergencyContact ?? null,
    notes: input.notes ?? null,
    tags: input.tags ?? [],
  };
}

/** Escape user input for safe use inside a RegExp (prevents ReDoS / accidental metacharacters). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchFields(patch: MemberUpdateInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  if ('email' in out) {
    const email = out.email as string | null;
    out.emailLower = email ? email.toLowerCase() : null;
  }
  return out;
}

/**
 * Tenant-scoped Member repository. Every method runs through the guarded model, so it requires an
 * active TenantContext (ADR-0004) — calling it with no context throws rather than leaking.
 */
export class MemberRepository {
  constructor(private readonly model: Model<MemberDoc> = MemberModel) {}

  async create(input: MemberCreateInput): Promise<Member> {
    const created = await this.model.create(fields(input));
    return toMember(created.toObject() as unknown as MemberDoc);
  }

  async findById(id: string): Promise<Member | null> {
    const doc = await this.model.findById(id).lean<MemberDoc>().exec();
    return doc ? toMember(doc) : null;
  }

  async list(opts: { status?: MemberStatus; tag?: string } = {}): Promise<Member[]> {
    const filter: Record<string, unknown> = {};
    if (opts.status) filter.status = opts.status;
    if (opts.tag) filter.tags = opts.tag;
    const docs = await this.model.find(filter).sort({ lastName: 1 }).lean<MemberDoc[]>().exec();
    return docs.map(toMember);
  }

  /**
   * List members carrying any/all of the given tags (segment resolution). Empty `tags` ⇒ empty list
   * (never "everyone" — a segment send must be explicit about its audience).
   */
  async listByTags(tags: string[], match: 'any' | 'all' = 'any'): Promise<Member[]> {
    if (tags.length === 0) return [];
    const filter = match === 'all' ? { tags: { $all: tags } } : { tags: { $in: tags } };
    const docs = await this.model.find(filter).sort({ lastName: 1 }).lean<MemberDoc[]>().exec();
    return docs.map(toMember);
  }

  /**
   * Free-text member lookup over name/email/phone (staff search, kiosk roster add). Case-insensitive
   * substring match, tenant-scoped by the guard, capped to `limit`. Regex (not a text index) is fine at
   * dojo scale (hundreds of members); revisit with a $text index if a tenant ever grows large.
   */
  async search(query: string, limit = 20): Promise<Member[]> {
    const term = query.trim();
    if (!term) return [];
    const rx = new RegExp(escapeRegExp(term), 'i');
    const docs = await this.model
      .find({ $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }] })
      .sort({ lastName: 1 })
      .limit(limit)
      .lean<MemberDoc[]>()
      .exec();
    return docs.map(toMember);
  }

  /** Count members in the active tenant (guard injects tenantId), optionally by status. */
  async count(opts: { status?: MemberStatus } = {}): Promise<number> {
    const filter = opts.status ? { status: opts.status } : {};
    return this.model.countDocuments(filter).exec();
  }

  async update(id: string, patch: MemberUpdateInput): Promise<Member | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, patchFields(patch), { returnDocument: 'after' })
      .lean<MemberDoc>()
      .exec();
    return doc ? toMember(doc) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: String(id) }).exec();
    return (res.deletedCount ?? 0) > 0;
  }

  /**
   * Atomically link a tenant-global account to this member, but ONLY if it has no account yet
   * (compare-and-swap on `userId: null`). Returns true if this call linked it, false if the member is
   * unknown or already linked — so a re-played invite-accept cannot hijack an already-onboarded member.
   */
  async linkUserId(id: string, userId: string): Promise<boolean> {
    const res = await this.model
      .updateOne({ _id: String(id), userId: null }, { $set: { userId: String(userId) } })
      .exec();
    return (res.modifiedCount ?? 0) > 0;
  }
}
