import type { PlatformGrant, PlatformRole } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';

/**
 * Platform-grant persistence (ADR-0021). Ties a TENANT-GLOBAL `User` to a platform role for the
 * cross-tenant oversight plane. Like `User`/`Identity`/`Session`/`Tenant`, it is itself tenant-global
 * and so is intentionally EXEMPT from `tenantGuard` (ADR-0004) — it is not data owned by any tenant.
 * `findByUserId` runs at the request trust boundary (BEFORE any context exists) to resolve a user's
 * platform role, mirroring `MembershipRepository.resolveForRequest`. One grant per user.
 */
export interface PlatformGrantDoc {
  _id: Types.ObjectId;
  userId: string;
  role: PlatformRole;
  createdAt: Date;
  updatedAt: Date;
}

const platformGrantSchema = new Schema<PlatformGrantDoc>(
  {
    userId: { type: String, required: true, unique: true },
    role: { type: String, required: true },
  },
  { timestamps: true },
);

export const PlatformGrantModel: Model<PlatformGrantDoc> =
  (mongoose.models.PlatformGrant as Model<PlatformGrantDoc> | undefined) ??
  mongoose.model<PlatformGrantDoc>('PlatformGrant', platformGrantSchema);

export function toPlatformGrant(doc: PlatformGrantDoc): PlatformGrant {
  return {
    id: doc._id.toString() as PlatformGrant['id'],
    userId: doc.userId as PlatformGrant['userId'],
    role: doc.role,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class PlatformGrantRepository {
  constructor(private readonly model: Model<PlatformGrantDoc> = PlatformGrantModel) {}

  /** Resolve a user's platform grant (or null). Used at the request boundary before context exists. */
  async findByUserId(userId: string): Promise<PlatformGrant | null> {
    const doc = await this.model
      .findOne({ userId: String(userId) })
      .lean<PlatformGrantDoc>()
      .exec();
    return doc ? toPlatformGrant(doc) : null;
  }

  /** Grant (or update) a user's platform role. Idempotent per user (upsert on the unique userId). */
  async grant(input: { userId: string; role: PlatformRole }): Promise<PlatformGrant> {
    const doc = await this.model
      .findOneAndUpdate(
        { userId: String(input.userId) },
        { $set: { role: input.role } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .lean<PlatformGrantDoc>()
      .exec();
    return toPlatformGrant(doc as PlatformGrantDoc);
  }

  async list(): Promise<PlatformGrant[]> {
    const docs = await this.model.find({}).sort({ createdAt: 1 }).lean<PlatformGrantDoc[]>().exec();
    return docs.map(toPlatformGrant);
  }

  /** Revoke a user's platform access entirely. */
  async revoke(userId: string): Promise<void> {
    await this.model.deleteOne({ userId: String(userId) }).exec();
  }
}
