import type { Tenant, TenantStatus } from '@obikai/domain';
import mongoose, { type Model, Schema } from 'mongoose';
import { PlatformContextError } from './errors.js';
import { isPlatformContext } from './tenant-context.js';

/**
 * Tenant registry persistence (ADR-0017). The `Tenant` collection is TENANT-GLOBAL — it is the
 * registry *of* tenants, not data *owned by* one — so it is intentionally EXEMPT from `tenantGuard`
 * (like `User`/`Identity`/`Session`, ADR-0004/0012). The deliberate exemption is asserted in
 * test/tenant.test.ts (the schema has no `tenantId` path).
 *
 * The `slug` is the natural key, so it is stored AS `_id` (a string): uniqueness is enforced by the
 * primary key with no extra index, and `id === slug === tenantId` falls out for free.
 *
 * Single-slug operations (find/create/ensureRegistered/updateStatus) work in any context — the
 * bootstrap registers the self-host tenant before any context exists, and request flows look up the
 * resolved slug. ENUMERATION (`list`/`listActive`) is a cross-tenant read and therefore requires the
 * explicit `runAsPlatform(...)` marker — "all tenants" is never implicit (ADR-0004).
 */
export interface TenantDoc {
  _id: string; // the slug — also the tenantId
  name: string;
  status: TenantStatus;
  createdAt: Date;
  updatedAt: Date;
}

const tenantSchema = new Schema<TenantDoc>(
  {
    _id: { type: String, required: true },
    name: { type: String, required: true },
    status: { type: String, required: true, default: 'active' },
  },
  { timestamps: true, _id: false },
);
// Hot platform query: active tenants for the billing-tick fan-out, by slug.
tenantSchema.index({ status: 1, _id: 1 });

export const TenantModel: Model<TenantDoc> =
  (mongoose.models.Tenant as Model<TenantDoc> | undefined) ??
  mongoose.model<TenantDoc>('Tenant', tenantSchema);

export function toTenant(doc: TenantDoc): Tenant {
  return {
    id: doc._id as Tenant['id'],
    slug: doc._id,
    name: doc.name,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/**
 * The registry of tenants. Single-slug methods are context-agnostic; the enumeration methods refuse
 * to run outside an explicit platform marker so a cross-tenant read can never happen by accident.
 */
export class TenantRegistryRepository {
  constructor(private readonly model: Model<TenantDoc> = TenantModel) {}

  /** Guard: enumeration is a cross-tenant read; it must be wrapped in `runAsPlatform(...)`. */
  private assertPlatform(op: string): void {
    if (!isPlatformContext()) {
      throw new PlatformContextError(
        `TenantRegistryRepository.${op} enumerates all tenants and must run inside runAsPlatform(...)`,
      );
    }
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const doc = await this.model.findById(String(slug)).lean<TenantDoc>().exec();
    return doc ? toTenant(doc) : null;
  }

  async create(input: { slug: string; name: string; status?: TenantStatus }): Promise<Tenant> {
    const created = await this.model.create({
      _id: input.slug,
      name: input.name,
      status: input.status ?? 'active',
    });
    return toTenant(created.toObject() as unknown as TenantDoc);
  }

  /**
   * Idempotent registration (self-host bootstrap, ADR-0009). Inserts the tenant if absent and
   * returns it either way; an existing tenant is never mutated (re-running create-owner is a no-op).
   */
  async ensureRegistered(input: {
    slug: string;
    name: string;
    status?: TenantStatus;
  }): Promise<Tenant> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: String(input.slug) },
        { $setOnInsert: { name: input.name, status: input.status ?? 'active' } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
      )
      .lean<TenantDoc>()
      .exec();
    // `returnDocument: 'after'` + upsert always returns the (existing or freshly-inserted) document.
    return toTenant(doc as TenantDoc);
  }

  /** Set a tenant's lifecycle status (active → suspended/archived and back). */
  async updateStatus(slug: string, status: TenantStatus): Promise<Tenant | null> {
    const doc = await this.model
      .findByIdAndUpdate(String(slug), { status }, { returnDocument: 'after' })
      .lean<TenantDoc>()
      .exec();
    return doc ? toTenant(doc) : null;
  }

  /** Enumerate tenants (optionally by status), slug-sorted. Platform-context only. */
  async list(opts: { status?: TenantStatus } = {}): Promise<Tenant[]> {
    this.assertPlatform('list');
    const filter = opts.status ? { status: opts.status } : {};
    const docs = await this.model.find(filter).sort({ _id: 1 }).lean<TenantDoc[]>().exec();
    return docs.map(toTenant);
  }

  /** Convenience for the scheduler fan-out: every active tenant. Platform-context only. */
  async listActive(): Promise<Tenant[]> {
    return this.list({ status: 'active' });
  }
}
