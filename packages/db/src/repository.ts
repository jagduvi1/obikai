/**
 * `TenantRepository` — a thin, tenant-scoped wrapper over a Mongoose `Model` (ADR-0004). The
 * `tenantGuard` plugin already scopes ordinary queries, but two write paths bypass Mongoose
 * middleware entirely and MUST go through this layer:
 *
 *  - `bulkWrite` — no document or query middleware fires. This wrapper tenant-stamps every
 *    operation's `filter` and every upsert's `$setOnInsert` so a bulk import cannot write to, or
 *    match, another tenant.
 *  - upserts in general — `$setOnInsert` must carry `tenantId`, else an upsert that inserts creates
 *    a doc with no tenant.
 *
 * Every method reads the active tenant from `getTenantIdOrThrow()`, so calling a repository with no
 * `TenantContext` (or under `runAsPlatform`) is a loud crash, never a silent unscoped operation.
 *
 * NOTE on indexes: per-tenant unique constraints must LEAD with `tenantId`
 * (`{ tenantId: 1, field: 1 }`, unique) — use `tenantUniqueIndex` from `./tenant-guard.js`. A bare
 * `{ field: 1 }` unique index would be global and would both leak existence across tenants and
 * reject legitimately-duplicate values in different tenants.
 */
import type {
  AnyBulkWriteOperation,
  FilterQuery,
  Model,
  MongooseBulkWriteOptions,
  UpdateQuery,
} from 'mongoose';
import { CrossTenantWriteError } from './errors.js';
import { getTenantIdOrThrow } from './tenant-context.js';

/** A document that carries the mandatory tenant discriminator. */
export interface TenantScoped {
  tenantId: string;
}

/** Merge `{ tenantId }` into a filter, rejecting an explicit foreign tenant. */
function withTenantFilter<T>(filter: FilterQuery<T>, tenantId: string): FilterQuery<T> {
  const existing = (filter as Record<string, unknown>).tenantId;
  if (existing !== undefined && existing !== tenantId) {
    throw new CrossTenantWriteError(tenantId, String(existing));
  }
  return { ...filter, tenantId } as FilterQuery<T>;
}

export class TenantRepository<T extends TenantScoped> {
  constructor(protected readonly model: Model<T>) {}

  /** Create one document, tenant-stamped from context. The `pre('save')` hook also enforces this. */
  async create(doc: Omit<T, 'tenantId'> & Partial<Pick<T, 'tenantId'>>): Promise<T> {
    const tenantId = getTenantIdOrThrow();
    const created = await this.model.create({ ...doc, tenantId });
    return created.toObject() as T;
  }

  /** Find by id WITHIN the active tenant. Returns null for "not found OR belongs to another tenant". */
  async findById(id: string): Promise<T | null> {
    const tenantId = getTenantIdOrThrow();
    return this.model
      .findOne({ _id: id, tenantId } as FilterQuery<T>)
      .lean<T>()
      .exec();
  }

  /** Find many within the active tenant. The guard also injects `{ tenantId }`; we set it here too. */
  async find(filter: FilterQuery<T> = {}): Promise<T[]> {
    const tenantId = getTenantIdOrThrow();
    return this.model.find(withTenantFilter(filter, tenantId)).lean<T[]>().exec();
  }

  /** Update by id within the active tenant; returns the updated doc or null if not in this tenant. */
  async updateById(id: string, update: UpdateQuery<T>): Promise<T | null> {
    const tenantId = getTenantIdOrThrow();
    return this.model
      .findOneAndUpdate({ _id: id, tenantId } as FilterQuery<T>, update, { new: true })
      .lean<T>()
      .exec();
  }

  /** Delete by id within the active tenant; returns true if a doc in this tenant was deleted. */
  async deleteById(id: string): Promise<boolean> {
    const tenantId = getTenantIdOrThrow();
    const res = await this.model.deleteOne({ _id: id, tenantId } as FilterQuery<T>).exec();
    return (res.deletedCount ?? 0) > 0;
  }

  /**
   * Guarded `bulkWrite`. Mongoose runs NO middleware for `Model.bulkWrite`, so this is the only safe
   * way to issue bulk ops on a guarded model. Every operation's `filter` is tenant-scoped, every
   * upsert's `$setOnInsert` is tenant-stamped, and `insertOne` documents are tenant-stamped — so a
   * bulk import can neither match nor create another tenant's data.
   */
  async bulkWrite(
    operations: AnyBulkWriteOperation<T>[],
    options?: MongooseBulkWriteOptions,
  ): Promise<Awaited<ReturnType<Model<T>['bulkWrite']>>> {
    const tenantId = getTenantIdOrThrow();
    const scoped = operations.map((op) => this.scopeBulkOperation(op, tenantId));
    // Mongoose's bulkWrite generic constrains `T extends Document`; our T is a plain `TenantScoped`
    // shape, so we cast the (already tenant-scoped) operations at this single, contained boundary.
    return options === undefined
      ? this.model.bulkWrite(scoped as never)
      : this.model.bulkWrite(scoped as never, options);
  }

  /** Tenant-scope a single bulk operation: stamp filters, `$setOnInsert`, and inserted docs. */
  private scopeBulkOperation(
    op: AnyBulkWriteOperation<T>,
    tenantId: string,
  ): AnyBulkWriteOperation<T> {
    const record = op as Record<string, Record<string, unknown>>;

    if (record.insertOne) {
      const document = (record.insertOne.document ?? {}) as Record<string, unknown>;
      return {
        insertOne: { document: { ...document, tenantId } },
      } as unknown as AnyBulkWriteOperation<T>;
    }

    for (const key of ['updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany']) {
      const inner = record[key];
      if (!inner) continue;
      const filter = withTenantFilter((inner.filter ?? {}) as FilterQuery<T>, tenantId) as Record<
        string,
        unknown
      >;
      const next: Record<string, unknown> = { ...inner, filter };
      // For upserts, $setOnInsert MUST carry tenantId or an inserting upsert creates an unscoped doc.
      if ((key === 'updateOne' || key === 'updateMany') && inner.upsert === true) {
        const update = (inner.update ?? {}) as Record<string, unknown>;
        const setOnInsert = (update.$setOnInsert ?? {}) as Record<string, unknown>;
        next.update = { ...update, $setOnInsert: { ...setOnInsert, tenantId } };
      }
      if (key === 'replaceOne' && inner.upsert === true) {
        const replacement = (inner.replacement ?? {}) as Record<string, unknown>;
        next.replacement = { ...replacement, tenantId };
      }
      return { [key]: next } as unknown as AnyBulkWriteOperation<T>;
    }

    return op;
  }
}
