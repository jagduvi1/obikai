import type { Location, LocationCreateInput, LocationUpdateInput } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Location persistence (scope §4.10, ADR-0011). A physical dojo location for multi-location support;
 * each location pins its own timezone for scheduling/attendance (ADR-0014). The `tenantGuard` plugin
 * scopes every query/write to the active tenant; this layer only maps between Mongoose docs and the
 * `@obikai/domain` Location shape.
 */
export interface LocationDoc extends TenantScoped {
  _id: Types.ObjectId;
  name: string;
  timezone: string;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<LocationDoc>(
  {
    name: { type: String, required: true },
    timezone: { type: String, required: true, default: 'Europe/Stockholm' },
    address: { type: String, default: null },
  },
  { timestamps: true },
);

locationSchema.plugin(tenantGuard);
// Hot list query: locations by name, alphabetical, scoped to the tenant.
locationSchema.index({ tenantId: 1, name: 1 });

export const LocationModel: Model<LocationDoc> =
  (mongoose.models.Location as Model<LocationDoc> | undefined) ??
  mongoose.model<LocationDoc>('Location', locationSchema);

export function toLocation(doc: LocationDoc): Location {
  return {
    id: doc._id.toString() as Location['id'],
    tenantId: doc.tenantId as Location['tenantId'],
    name: doc.name,
    timezone: doc.timezone,
    address: doc.address,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function patchFields(patch: LocationUpdateInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Tenant-scoped Location repository. Every method runs through the guarded model, so it requires an
 * active TenantContext (ADR-0004) — calling it with no context throws rather than leaking.
 */
export class LocationRepository {
  constructor(private readonly model: Model<LocationDoc> = LocationModel) {}

  async create(input: LocationCreateInput): Promise<Location> {
    const created = await this.model.create({
      name: input.name,
      timezone: input.timezone,
      address: input.address ?? null,
    });
    return toLocation(created.toObject() as unknown as LocationDoc);
  }

  async findById(id: string): Promise<Location | null> {
    const doc = await this.model.findById(id).lean<LocationDoc>().exec();
    return doc ? toLocation(doc) : null;
  }

  async list(): Promise<Location[]> {
    const docs = await this.model.find({}).sort({ name: 1 }).lean<LocationDoc[]>().exec();
    return docs.map(toLocation);
  }

  async update(id: string, patch: LocationUpdateInput): Promise<Location | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, patchFields(patch), { new: true })
      .lean<LocationDoc>()
      .exec();
    return doc ? toLocation(doc) : null;
  }
}
