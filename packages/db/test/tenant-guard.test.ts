/**
 * Leakage tests for the multi-tenant isolation seam (ADR-0004). These exercise the REAL guard
 * against a real Mongoose connection backed by an in-memory MongoDB, so they catch the holes a
 * naive plugin leaves: missing context, unstamped bulk/insertMany writes, and unfiltered
 * aggregation joins. They require a downloaded `mongodb-memory-server` binary to run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Model, Schema } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MissingTenantContextError, UnsafeAggregationError } from '../src/errors.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';
import { tenantGuard } from '../src/tenant-guard.js';

interface WidgetDoc {
  tenantId: string;
  name: string;
  ownerId?: string;
}

interface GadgetDoc {
  tenantId: string;
  widgetName: string;
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

function ctx(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: 'user-1',
    sessionId: 'session-1',
    roles: ['owner'],
    locationScope: 'ALL',
    requestId: `req-${tenantId}`,
    tenancy: 'multi',
  };
}

let mongod: MongoMemoryServer;
let Widget: Model<WidgetDoc>;
let Gadget: Model<GadgetDoc>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const widgetSchema = new Schema<WidgetDoc>({ name: String, ownerId: String });
  widgetSchema.plugin(tenantGuard);
  Widget = mongoose.model<WidgetDoc>('Widget', widgetSchema);

  const gadgetSchema = new Schema<GadgetDoc>({ widgetName: String });
  gadgetSchema.plugin(tenantGuard);
  Gadget = mongoose.model<GadgetDoc>('Gadget', gadgetSchema);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

describe('tenantGuard — context enforcement', () => {
  it('throws when a query runs with NO tenant context', async () => {
    await expect(Widget.find({}).exec()).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it('throws when a save runs with NO tenant context', async () => {
    await expect(new Widget({ name: 'orphan' }).save()).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
  });
});

describe('tenantGuard — write stamping', () => {
  it('insertMany stamps tenantId on every doc', async () => {
    await runInTenantContext(ctx(TENANT_A), () =>
      Widget.insertMany([{ name: 'w1' }, { name: 'w2' }] as WidgetDoc[]),
    );
    const stamped = await runInTenantContext(ctx(TENANT_A), () =>
      Widget.find({ name: { $in: ['w1', 'w2'] } })
        .lean()
        .exec(),
    );
    expect(stamped).toHaveLength(2);
    for (const doc of stamped) {
      expect(doc.tenantId).toBe(TENANT_A);
    }
  });

  it('save stamps tenantId from context on new docs', async () => {
    const saved = await runInTenantContext(ctx(TENANT_A), () =>
      new Widget({ name: 'saved-widget' }).save(),
    );
    expect(saved.tenantId).toBe(TENANT_A);
  });
});

describe('tenantGuard — read isolation', () => {
  it('a find in tenant A never returns tenant B docs', async () => {
    await runInTenantContext(ctx(TENANT_A), () => new Widget({ name: 'a-only' }).save());
    await runInTenantContext(ctx(TENANT_B), () => new Widget({ name: 'b-only' }).save());

    const aResults = await runInTenantContext(ctx(TENANT_A), () => Widget.find({}).lean().exec());
    expect(aResults.some((w) => w.name === 'b-only')).toBe(false);
    expect(aResults.every((w) => w.tenantId === TENANT_A)).toBe(true);

    const bResults = await runInTenantContext(ctx(TENANT_B), () => Widget.find({}).lean().exec());
    expect(bResults.some((w) => w.name === 'a-only')).toBe(false);
    expect(bResults.every((w) => w.tenantId === TENANT_B)).toBe(true);
  });
});

describe('tenantGuard — aggregation isolation', () => {
  it('an aggregate $lookup (pipeline form) does not pull tenant B rows', async () => {
    // A widget named 'shared' exists in BOTH tenants; the gadget references it by name.
    await runInTenantContext(ctx(TENANT_A), async () => {
      await new Widget({ name: 'shared' }).save();
      await new Gadget({ widgetName: 'shared' }).save();
    });
    await runInTenantContext(ctx(TENANT_B), async () => {
      await new Widget({ name: 'shared' }).save();
    });

    const rows = await runInTenantContext(ctx(TENANT_A), () =>
      Gadget.aggregate([
        { $match: { widgetName: 'shared' } },
        {
          $lookup: {
            from: 'widgets',
            let: { wn: '$widgetName' },
            pipeline: [{ $match: { $expr: { $eq: ['$name', '$$wn'] } } }],
            as: 'widgets',
          },
        },
      ]).exec(),
    );

    const joined = rows.flatMap((r: { widgets: WidgetDoc[] }) => r.widgets);
    expect(joined.length).toBeGreaterThan(0);
    // The injected inner $match must keep the join inside tenant A only.
    expect(joined.every((w) => w.tenantId === TENANT_A)).toBe(true);
  });

  it('throws on the localField form of $lookup', async () => {
    await expect(
      runInTenantContext(ctx(TENANT_A), () =>
        Gadget.aggregate([
          {
            $lookup: {
              from: 'widgets',
              localField: 'widgetName',
              foreignField: 'name',
              as: 'widgets',
            },
          },
        ]).exec(),
      ),
    ).rejects.toBeInstanceOf(UnsafeAggregationError);
  });

  it('throws when $merge appears in an aggregation', async () => {
    await expect(
      runInTenantContext(ctx(TENANT_A), () =>
        Widget.aggregate([{ $merge: { into: 'widgets' } }]).exec(),
      ),
    ).rejects.toBeInstanceOf(UnsafeAggregationError);
  });

  it('throws when $out appears in an aggregation', async () => {
    await expect(
      runInTenantContext(ctx(TENANT_A), () => Widget.aggregate([{ $out: 'widgets_copy' }]).exec()),
    ).rejects.toBeInstanceOf(UnsafeAggregationError);
  });
});
