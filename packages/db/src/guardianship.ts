import type { Guardianship, Permission } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Guardianship persistence (ADR-0004, scope §4.10) — the parent → minor delegation edge. One guardian
 * (a tenant-global User) may link to MANY minor Members (many rows). Tenant-scoped via `tenantGuard`.
 * The tenancy middleware loads a request actor's edges via `listByGuardian` and hands them to `can()`.
 */
export interface GuardianshipDoc extends TenantScoped {
  _id: Types.ObjectId;
  guardianUserId: string;
  minorMemberId: string;
  grants: { resource: string; action: string }[];
  revokedAt: Date | null;
  createdAt: Date;
}

const grantSchema = new Schema(
  { resource: { type: String, required: true }, action: { type: String, required: true } },
  { _id: false },
);

const guardianshipSchema = new Schema<GuardianshipDoc>(
  {
    guardianUserId: { type: String, required: true },
    minorMemberId: { type: String, required: true },
    grants: { type: [grantSchema], default: [] },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

guardianshipSchema.plugin(tenantGuard);
// The hot path: load all edges a guardian holds (per request, in the tenancy middleware).
guardianshipSchema.index({ tenantId: 1, guardianUserId: 1 });
// List a minor's guardians (the member-detail "Guardians" view).
guardianshipSchema.index({ tenantId: 1, minorMemberId: 1 });
// One edge per (guardian, minor): re-linking is idempotent, not a duplicate.
guardianshipSchema.index({ tenantId: 1, guardianUserId: 1, minorMemberId: 1 }, { unique: true });

export const GuardianshipModel: Model<GuardianshipDoc> =
  (mongoose.models.Guardianship as Model<GuardianshipDoc> | undefined) ??
  mongoose.model<GuardianshipDoc>('Guardianship', guardianshipSchema);

export function toGuardianship(doc: GuardianshipDoc): Guardianship {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId as Guardianship['tenantId'],
    guardianUserId: doc.guardianUserId as Guardianship['guardianUserId'],
    minorMemberId: doc.minorMemberId as Guardianship['minorMemberId'],
    grants: doc.grants.map((g) => ({
      resource: g.resource,
      action: g.action,
    })) as Permission[],
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Raised when re-linking a (guardian, minor) pair that already exists (the unique-index backstop). */
export class DuplicateGuardianshipError extends Error {
  constructor(guardianUserId: string, minorMemberId: string) {
    super(`guardian ${guardianUserId} is already linked to minor ${minorMemberId}`);
    this.name = 'DuplicateGuardianshipError';
  }
}

export class GuardianshipRepository {
  constructor(private readonly model: Model<GuardianshipDoc> = GuardianshipModel) {}

  async create(input: {
    guardianUserId: string;
    minorMemberId: string;
    grants: readonly Permission[];
  }): Promise<Guardianship> {
    try {
      const created = await this.model.create({
        guardianUserId: input.guardianUserId,
        minorMemberId: input.minorMemberId,
        grants: input.grants.map((g) => ({ resource: g.resource, action: g.action })),
        revokedAt: null,
      });
      return toGuardianship(created.toObject() as unknown as GuardianshipDoc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw new DuplicateGuardianshipError(input.guardianUserId, input.minorMemberId);
      }
      throw err;
    }
  }

  /** Active (non-revoked) edges a guardian holds — the per-request actor load. */
  async listByGuardian(guardianUserId: string): Promise<Guardianship[]> {
    const docs = await this.model
      .find({ guardianUserId: String(guardianUserId), revokedAt: null })
      .lean<GuardianshipDoc[]>()
      .exec();
    return docs.map(toGuardianship);
  }

  /** A minor's guardians (the member-detail view). Includes revoked unless filtered by the caller. */
  async listByMinor(minorMemberId: string): Promise<Guardianship[]> {
    const docs = await this.model
      .find({ minorMemberId: String(minorMemberId) })
      .lean<GuardianshipDoc[]>()
      .exec();
    return docs.map(toGuardianship);
  }

  /** Revoke an edge (idempotent); returns true if a live edge was revoked. */
  async revoke(id: string, at: Date): Promise<boolean> {
    const res = await this.model
      .updateOne({ _id: String(id), revokedAt: null }, { $set: { revokedAt: at } })
      .exec();
    return (res.modifiedCount ?? 0) > 0;
  }
}
