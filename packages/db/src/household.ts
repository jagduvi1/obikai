import type { Household, HouseholdCreateInput } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/** Household persistence (ADR-0011): the billing/family unit, one payer ↔ many members. */
export interface HouseholdDoc extends TenantScoped {
  _id: Types.ObjectId;
  name: string;
  payerMemberId: string | null;
  payerUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const householdSchema = new Schema<HouseholdDoc>(
  {
    name: { type: String, required: true },
    payerMemberId: { type: String, default: null },
    payerUserId: { type: String, default: null },
  },
  { timestamps: true },
);

householdSchema.plugin(tenantGuard);
householdSchema.index({ tenantId: 1, name: 1 });

export const HouseholdModel: Model<HouseholdDoc> =
  (mongoose.models.Household as Model<HouseholdDoc> | undefined) ??
  mongoose.model<HouseholdDoc>('Household', householdSchema);

export function toHousehold(doc: HouseholdDoc): Household {
  return {
    id: doc._id.toString() as Household['id'],
    tenantId: doc.tenantId as Household['tenantId'],
    name: doc.name,
    payerMemberId: (doc.payerMemberId as Household['payerMemberId']) ?? null,
    payerUserId: (doc.payerUserId as Household['payerUserId']) ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class HouseholdRepository {
  constructor(private readonly model: Model<HouseholdDoc> = HouseholdModel) {}

  async create(input: HouseholdCreateInput): Promise<Household> {
    const created = await this.model.create({
      name: input.name,
      payerMemberId: input.payerMemberId ?? null,
      payerUserId: input.payerUserId ?? null,
    });
    return toHousehold(created.toObject() as unknown as HouseholdDoc);
  }

  async findById(id: string): Promise<Household | null> {
    const doc = await this.model.findById(id).lean<HouseholdDoc>().exec();
    return doc ? toHousehold(doc) : null;
  }

  async list(): Promise<Household[]> {
    const docs = await this.model.find({}).sort({ name: 1 }).lean<HouseholdDoc[]>().exec();
    return docs.map(toHousehold);
  }
}
