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
  };
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

  async list(opts: { status?: MemberStatus } = {}): Promise<Member[]> {
    const filter = opts.status ? { status: String(opts.status) } : {};
    const docs = await this.model.find(filter).sort({ lastName: 1 }).lean<MemberDoc[]>().exec();
    return docs.map(toMember);
  }

  async update(id: string, patch: MemberUpdateInput): Promise<Member | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, patchFields(patch), { new: true })
      .lean<MemberDoc>()
      .exec();
    return doc ? toMember(doc) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: String(id) }).exec();
    return (res.deletedCount ?? 0) > 0;
  }
}
