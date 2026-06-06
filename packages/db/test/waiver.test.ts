/**
 * Waiver repository tests (ADR-0014, scope §4.10) against a real Mongoose connection backed by an
 * in-memory MongoDB. Verifies template VERSIONING (editing the body mints a new version), that a
 * signature PINS the version it was signed under (a later edit never rewrites it), and that tenant
 * isolation flows through the repositories. Requires a downloaded `mongodb-memory-server` binary.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MissingTenantContextError } from '../src/errors.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';
import {
  WaiverSignatureModel,
  WaiverSignatureRepository,
  WaiverTemplateModel,
  WaiverTemplateRepository,
} from '../src/waiver.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'staff', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

const templateInput = {
  title: 'Liability Waiver',
  bodyMarkdown: 'Original body',
  requiresGuardianForMinor: true,
  active: true,
};

let mongod: MongoMemoryServer;
const templates = new WaiverTemplateRepository();
const signatures = new WaiverSignatureRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await WaiverTemplateModel.syncIndexes();
  await WaiverSignatureModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  // Clear via the raw driver — bypasses the guard so no tenant context is needed for teardown.
  await mongoose.connection.collection('waivertemplates').deleteMany({});
  await mongoose.connection.collection('waiversignatures').deleteMany({});
});

describe('WaiverTemplateRepository', () => {
  it('refuses to operate with no tenant context (ADR-0004)', async () => {
    await expect(templates.create(templateInput)).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it('creates a template at version 1', async () => {
    const created = await runInTenantContext(ctx('t1'), () => templates.create(templateInput));
    expect(created.tenantId).toBe('t1');
    expect(created.version).toBe(1);
    expect(created.title).toBe('Liability Waiver');
  });

  it('mints a new version when the body is edited', async () => {
    const created = await runInTenantContext(ctx('t1'), () => templates.create(templateInput));
    const v2 = await runInTenantContext(ctx('t1'), () =>
      templates.updateBody(created.id, { bodyMarkdown: 'Revised body' }),
    );
    expect(v2?.version).toBe(2);
    expect(v2?.bodyMarkdown).toBe('Revised body');

    const v3 = await runInTenantContext(ctx('t1'), () =>
      templates.updateBody(created.id, { active: false }),
    );
    expect(v3?.version).toBe(3);
    expect(v3?.active).toBe(false);
  });

  it('lists active templates within the active tenant only', async () => {
    await runInTenantContext(ctx('t1'), () => templates.create(templateInput));
    await runInTenantContext(ctx('t1'), () =>
      templates.create({ ...templateInput, title: 'Photo Release', active: false }),
    );
    await runInTenantContext(ctx('t2'), () => templates.create(templateInput));

    const t1Active = await runInTenantContext(ctx('t1'), () => templates.list({ active: true }));
    expect(t1Active.map((t) => t.title)).toEqual(['Liability Waiver']);

    const t1All = await runInTenantContext(ctx('t1'), () => templates.list());
    expect(t1All).toHaveLength(2);
  });

  it("does not return another tenant's templates", async () => {
    const a = await runInTenantContext(ctx('t1'), () => templates.create(templateInput));
    const crossRead = await runInTenantContext(ctx('t2'), () => templates.findById(a.id));
    expect(crossRead).toBeNull();
  });
});

describe('WaiverSignatureRepository', () => {
  it('pins the template version at signing; a later edit never rewrites it', async () => {
    const template = await runInTenantContext(ctx('t1'), () => templates.create(templateInput));

    // Sign under v1.
    const sig = await runInTenantContext(ctx('t1'), () =>
      signatures.create({
        templateId: template.id,
        templateVersion: template.version,
        memberId: 'm1',
        signedByUserId: 'u1',
        signedByName: 'Aiko Tanaka',
        isGuardian: false,
        guardianForMemberId: null,
        signedAt: '2026-06-06T10:00:00.000Z',
        ip: '203.0.113.7',
        documentStorageKey: null,
      }),
    );
    expect(sig.templateVersion).toBe(1);
    expect(sig.documentStorageKey).toBeNull();

    // Edit the template → v2.
    const v2 = await runInTenantContext(ctx('t1'), () =>
      templates.updateBody(template.id, { bodyMarkdown: 'Revised body' }),
    );
    expect(v2?.version).toBe(2);

    // The earlier signature still pins v1 — immutable.
    const stored = await runInTenantContext(ctx('t1'), () => signatures.findById(sig.id));
    expect(stored?.templateVersion).toBe(1);
  });

  it('lists a member signatures and a template signatures within the tenant', async () => {
    const template = await runInTenantContext(ctx('t1'), () => templates.create(templateInput));
    const base = {
      templateId: template.id,
      templateVersion: template.version,
      signedByUserId: 'u1',
      signedByName: 'Signer',
      isGuardian: false,
      guardianForMemberId: null,
      ip: null,
      documentStorageKey: null,
    };
    await runInTenantContext(ctx('t1'), () =>
      signatures.create({ ...base, memberId: 'm1', signedAt: '2026-06-06T10:00:00.000Z' }),
    );
    await runInTenantContext(ctx('t1'), () =>
      signatures.create({ ...base, memberId: 'm2', signedAt: '2026-06-06T11:00:00.000Z' }),
    );

    const forM1 = await runInTenantContext(ctx('t1'), () => signatures.listByMember('m1'));
    expect(forM1).toHaveLength(1);
    expect(forM1[0]?.memberId).toBe('m1');

    const forTemplate = await runInTenantContext(ctx('t1'), () =>
      signatures.listByTemplate(template.id),
    );
    expect(forTemplate).toHaveLength(2);
  });

  it("does not return another tenant's signatures", async () => {
    const template = await runInTenantContext(ctx('t1'), () => templates.create(templateInput));
    await runInTenantContext(ctx('t1'), () =>
      signatures.create({
        templateId: template.id,
        templateVersion: template.version,
        memberId: 'm1',
        signedByUserId: 'u1',
        signedByName: 'Aiko',
        isGuardian: false,
        guardianForMemberId: null,
        signedAt: '2026-06-06T10:00:00.000Z',
        ip: null,
        documentStorageKey: null,
      }),
    );
    const t2List = await runInTenantContext(ctx('t2'), () => signatures.listByMember('m1'));
    expect(t2List).toEqual([]);
  });
});
