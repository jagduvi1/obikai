import type { BillingProfileInput, TenantBillingProfile } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Seller billing/legal profile persistence (ADR-0018). Tenant-OWNED config, so it IS guarded
 * (`tenantGuard`) — unlike the tenant-global registry `Tenant` (ADR-0017). Exactly one profile per
 * tenant: a unique index on `tenantId` enforces the singleton, and reads/writes go through a
 * context-scoped `findOne({})` / `findOneAndUpdate({})` (the guard injects the tenant).
 */
export interface BillingProfileDoc extends TenantScoped {
  _id: Types.ObjectId;
  /** Constant discriminator so a compound unique index `{tenantId, singleton}` enforces one profile
   *  per tenant WITHOUT colliding with the guard's own `tenantId` index. Never surfaced in the API. */
  singleton: 'profile';
  legalName: string;
  vatId: string | null;
  registrationNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  paymentDetails: string | null;
  footerNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const billingProfileSchema = new Schema<BillingProfileDoc>(
  {
    singleton: { type: String, default: 'profile', immutable: true },
    legalName: { type: String, required: true },
    vatId: { type: String, default: null },
    registrationNumber: { type: String, default: null },
    addressLine1: { type: String, default: null },
    addressLine2: { type: String, default: null },
    postalCode: { type: String, default: null },
    city: { type: String, default: null },
    country: { type: String, default: null },
    email: { type: String, default: null },
    paymentDetails: { type: String, default: null },
    footerNote: { type: String, default: null },
  },
  { timestamps: true },
);
billingProfileSchema.plugin(tenantGuard);
// One profile per tenant (singleton). Compound with the constant `singleton` so the index key
// differs from the guard's `tenantId` index — no name collision, no duplicate-index warning.
billingProfileSchema.index({ tenantId: 1, singleton: 1 }, { unique: true });

export const BillingProfileModel: Model<BillingProfileDoc> =
  (mongoose.models.BillingProfile as Model<BillingProfileDoc> | undefined) ??
  mongoose.model<BillingProfileDoc>('BillingProfile', billingProfileSchema);

export function toBillingProfile(doc: BillingProfileDoc): TenantBillingProfile {
  return {
    id: doc._id.toString() as TenantBillingProfile['id'],
    tenantId: doc.tenantId as TenantBillingProfile['tenantId'],
    legalName: doc.legalName,
    vatId: doc.vatId,
    registrationNumber: doc.registrationNumber,
    addressLine1: doc.addressLine1,
    addressLine2: doc.addressLine2,
    postalCode: doc.postalCode,
    city: doc.city,
    country: doc.country,
    email: doc.email,
    paymentDetails: doc.paymentDetails,
    footerNote: doc.footerNote,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Normalize the upsert input: every optional/undefined field collapses to an explicit null. */
function toSetFields(input: BillingProfileInput): Record<string, unknown> {
  return {
    legalName: input.legalName,
    vatId: input.vatId ?? null,
    registrationNumber: input.registrationNumber ?? null,
    addressLine1: input.addressLine1 ?? null,
    addressLine2: input.addressLine2 ?? null,
    postalCode: input.postalCode ?? null,
    city: input.city ?? null,
    country: input.country ?? null,
    email: input.email ?? null,
    paymentDetails: input.paymentDetails ?? null,
    footerNote: input.footerNote ?? null,
  };
}

/**
 * Tenant-scoped repository for the singleton billing profile. Requires an active TenantContext
 * (ADR-0004); the guard scopes every query to the current tenant.
 */
export class BillingProfileRepository {
  constructor(private readonly model: Model<BillingProfileDoc> = BillingProfileModel) {}

  /** The current tenant's profile, or null if not configured yet. */
  async get(): Promise<TenantBillingProfile | null> {
    const doc = await this.model.findOne({}).lean<BillingProfileDoc>().exec();
    return doc ? toBillingProfile(doc) : null;
  }

  /** Create-or-replace the current tenant's profile (PUT semantics). Idempotent per tenant. */
  async upsert(input: BillingProfileInput): Promise<TenantBillingProfile> {
    const doc = await this.model
      .findOneAndUpdate(
        {},
        { $set: toSetFields(input) },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .lean<BillingProfileDoc>()
      .exec();
    return toBillingProfile(doc as BillingProfileDoc);
  }
}
