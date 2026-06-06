/**
 * `tenantGuard` — the Mongoose plugin that makes tenant isolation STRUCTURAL (ADR-0004). Applied to
 * every tenant-owned schema, it:
 *
 *  (a) adds an indexed, required `tenantId`;
 *  (b) pre-hooks every read/update/delete query to inject `{ tenantId }` from the active context;
 *  (c) stamps `tenantId` on new docs in `pre('validate')` and throws on a cross-tenant mismatch;
 *  (d) stamps `tenantId` on every doc in `pre('insertMany')`;
 *  (e) rewrites aggregations so foreign-collection joins cannot leak across tenants, and bans the
 *      stages that cannot be made safe.
 *
 * IMPORTANT — `bulkWrite` is NOT covered here. Mongoose runs no document/query middleware for
 * `Model.bulkWrite`, so the only safe path is `TenantRepository.bulkWrite` (see `repository.ts`),
 * which tenant-stamps every filter and `$setOnInsert`. Do not call `Model.bulkWrite` directly on a
 * guarded model.
 *
 * `User`/`Identity` are intentionally EXEMPT from this guard (tenant-global identity, ADR-0004): do
 * not apply `tenantGuard` to them.
 */
import type { Schema } from 'mongoose';
import { CrossTenantWriteError, UnsafeAggregationError } from './errors.js';
import { getTenantIdOrThrow } from './tenant-context.js';

/**
 * Minimal view of the schema surface the guard touches (`add`, `pre`, `index`). Mongoose's own
 * `Schema.pre` overloads are strict about hook `this`/arity per op; routing through this narrow,
 * permissive interface lets us register the hooks with the loose `this` shapes we actually use
 * without fighting overload resolution. `tenantGuard` accepts `Schema` and narrows to this.
 */
interface GuardableSchema {
  add(obj: Record<string, unknown>): unknown;
  pre(op: unknown, fn: (...args: never[]) => unknown): unknown;
  index(fields: Record<string, 1 | -1>, options?: Record<string, unknown>): unknown;
}

/** A query the read/update/delete pre-hook scopes; `this` is bound to a Mongoose `Query` at runtime. */
interface ScopedQueryThis {
  getFilter(): Record<string, unknown>;
  setQuery(filter: Record<string, unknown>): unknown;
}

/** An aggregate the pre-hook scopes; `this` is bound to a Mongoose `Aggregate` at runtime. */
interface ScopedAggregateThis {
  pipeline(): Record<string, unknown>[];
}

/** Query middleware ops whose filter must be scoped to the active tenant before they run. */
const SCOPED_QUERY_OPS = [
  'count',
  'countDocuments',
  'deleteMany',
  'deleteOne',
  'distinct',
  'find',
  'findOne',
  'findOneAndDelete',
  'findOneAndReplace',
  'findOneAndUpdate',
  'replaceOne',
  'updateMany',
  'updateOne',
] as const;

/** A loosely-typed aggregation pipeline stage; we narrow per-operator as we walk it. */
type Stage = Record<string, unknown>;

/** Inject `{ tenantId }` into a query filter unless the caller already pinned the SAME tenant. */
function scopeFilter(this: ScopedQueryThis): void {
  const tenantId = getTenantIdOrThrow();
  const filter = this.getFilter() ?? {};
  // A caller may legitimately re-state the active tenant; anything else is a programming error
  // that we surface rather than silently widen the scope.
  const existing = filter.tenantId;
  if (existing !== undefined && existing !== tenantId) {
    throw new CrossTenantWriteError(tenantId, String(existing));
  }
  this.setQuery({ ...filter, tenantId });
}

/**
 * Build the inner `{ $match: { tenantId } }` we inject into sub-pipelines. Foreign-collection joins
 * (`$lookup`/`$unionWith`/`$graphLookup`) do NOT inherit the top-level `$match`, so each must be
 * scoped independently or it returns another tenant's rows.
 */
function tenantMatchStage(tenantId: string): Stage {
  return { $match: { tenantId } };
}

/**
 * Recursively rewrite a sub-pipeline so every foreign-collection join inside it is also scoped, and
 * prepend a tenant `$match`. Used for `$lookup.pipeline` and `$unionWith.pipeline`.
 */
function scopeSubPipeline(pipeline: unknown, tenantId: string): Stage[] {
  if (!Array.isArray(pipeline)) {
    throw new UnsafeAggregationError('expected an array pipeline in a $lookup/$unionWith stage');
  }
  const inner = pipeline as Stage[];
  for (const stage of inner) {
    scopeAggregationStage(stage, tenantId);
  }
  return [tenantMatchStage(tenantId), ...inner];
}

/**
 * Make a single aggregation stage tenant-safe IN PLACE, recursing into nested join pipelines.
 * Throws `UnsafeAggregationError` for stages that cannot be made safe.
 */
function scopeAggregationStage(stage: Stage, tenantId: string): void {
  // Banned outright in tenant scope: they write to arbitrary collections, bypassing the guard.
  if ('$merge' in stage) throw new UnsafeAggregationError('$merge is banned in tenant scope');
  if ('$out' in stage) throw new UnsafeAggregationError('$out is banned in tenant scope');

  if ('$lookup' in stage) {
    const lookup = stage.$lookup;
    if (typeof lookup !== 'object' || lookup === null) {
      throw new UnsafeAggregationError('$lookup must be an object');
    }
    const spec = lookup as Record<string, unknown>;
    // The localField/foreignField form joins the foreign collection UNFILTERED — there is no
    // pipeline to inject a tenant $match into — so it is banned. Use the pipeline form instead.
    if ('localField' in spec || 'foreignField' in spec) {
      throw new UnsafeAggregationError(
        'the localField/foreignField form of $lookup is banned in tenant scope; use the ' +
          'pipeline form so a tenant $match can be injected',
      );
    }
    spec.pipeline = scopeSubPipeline(spec.pipeline ?? [], tenantId);
    return;
  }

  if ('$unionWith' in stage) {
    const union = stage.$unionWith;
    // The string shorthand ($unionWith: 'coll') has no pipeline; normalize to the object form so we
    // can scope it.
    if (typeof union === 'string') {
      stage.$unionWith = { coll: union, pipeline: [tenantMatchStage(tenantId)] };
      return;
    }
    if (typeof union !== 'object' || union === null) {
      throw new UnsafeAggregationError('$unionWith must be a string or an object');
    }
    const spec = union as Record<string, unknown>;
    spec.pipeline = scopeSubPipeline(spec.pipeline ?? [], tenantId);
    return;
  }

  if ('$graphLookup' in stage) {
    const graph = stage.$graphLookup;
    if (typeof graph !== 'object' || graph === null) {
      throw new UnsafeAggregationError('$graphLookup must be an object');
    }
    const spec = graph as Record<string, unknown>;
    // $graphLookup has no pipeline; `restrictSearchWithMatch` is its filter on the foreign rows.
    const existing = spec.restrictSearchWithMatch;
    if (existing !== undefined && (typeof existing !== 'object' || existing === null)) {
      throw new UnsafeAggregationError('$graphLookup.restrictSearchWithMatch must be an object');
    }
    spec.restrictSearchWithMatch = {
      ...(existing as Record<string, unknown> | undefined),
      tenantId,
    };
    return;
  }

  // `$facet` runs independent sub-pipelines that also start from the unfiltered collection.
  if ('$facet' in stage) {
    const facet = stage.$facet;
    if (typeof facet !== 'object' || facet === null) {
      throw new UnsafeAggregationError('$facet must be an object');
    }
    const spec = facet as Record<string, unknown>;
    for (const key of Object.keys(spec)) {
      spec[key] = scopeSubPipeline(spec[key] ?? [], tenantId);
    }
  }
}

/** Scope a whole aggregation pipeline: unshift a top-level tenant `$match`, then walk every stage. */
function scopePipeline(this: ScopedAggregateThis): void {
  const tenantId = getTenantIdOrThrow();
  const pipeline = this.pipeline() as Stage[];
  for (const stage of pipeline) {
    scopeAggregationStage(stage, tenantId);
  }
  pipeline.unshift(tenantMatchStage(tenantId));
}

/** Stamp/verify tenantId on a single document headed for the database. */
function stampDoc(record: Record<string, unknown>, tenantId: string): void {
  const current = record.tenantId;
  if (current === undefined || current === null) {
    record.tenantId = tenantId;
  } else if (current !== tenantId) {
    throw new CrossTenantWriteError(tenantId, String(current));
  }
}

/**
 * The plugin. Register globally (`mongoose.plugin(tenantGuard)`) only if you exempt identity
 * schemas, or apply it per tenant-owned schema (`schema.plugin(tenantGuard)`).
 */
export function tenantGuard(schema: Schema): void {
  const s = schema as unknown as GuardableSchema;

  // (a) Mandatory, indexed tenant discriminator on every tenant-owned document.
  s.add({
    tenantId: { type: String, required: true, index: true, immutable: true },
  });

  // (b) Scope every read/update/delete query filter to the active tenant.
  s.pre(SCOPED_QUERY_OPS, function preScopedQuery(this: ScopedQueryThis, next: () => void) {
    scopeFilter.call(this);
    next();
  } as (...args: never[]) => unknown);

  // (c) Stamp tenantId on new docs; reject a doc whose tenantId belongs to another tenant.
  // Registered on 'validate' (NOT 'save'): Mongoose runs validation before save hooks, so stamping
  // in pre('save') would fail the required-tenantId validation first. pre('validate') also makes a
  // no-context write throw MissingTenantContextError rather than a Mongoose ValidationError.
  s.pre('validate', function preValidate(this: Record<string, unknown>, next: () => void) {
    stampDoc(this, getTenantIdOrThrow());
    next();
  } as (...args: never[]) => unknown);

  // (d) Stamp tenantId on every doc passed to insertMany (query middleware does not fire for it).
  s.pre('insertMany', function preInsertMany(next: () => void, docs: unknown) {
    const tenantId = getTenantIdOrThrow();
    if (Array.isArray(docs)) {
      for (const doc of docs) {
        if (doc !== null && typeof doc === 'object') {
          stampDoc(doc as Record<string, unknown>, tenantId);
        }
      }
    }
    next();
  } as (...args: never[]) => unknown);

  // (e) Make aggregations tenant-safe: top-level $match + recursive join scoping + banned stages.
  s.pre('aggregate', function preAggregate(this: ScopedAggregateThis, next: () => void) {
    scopePipeline.call(this);
    next();
  } as (...args: never[]) => unknown);
}

/**
 * Helper for declaring a compound index that LEADS with `tenantId` (ADR-0004): per-tenant
 * uniqueness must be `{ tenantId, ...fields }`, and hot queries should hit a tenantId-leading
 * IXSCAN, never a COLLSCAN. Use in schema setup, e.g.
 * `schema.index(...tenantUniqueIndex({ email: 1 }))`.
 */
export function tenantUniqueIndex(
  fields: Record<string, 1 | -1>,
): [Record<string, 1 | -1>, { unique: true }] {
  return [{ tenantId: 1, ...fields }, { unique: true }];
}

/** The exact set of `$merge`/`$out` stage keys this guard bans inside tenant scope (for tests/docs). */
export const BANNED_AGGREGATION_STAGES = ['$merge', '$out'] as const;
