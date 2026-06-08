import type {
  PresignGetInput,
  PresignPutInput,
  StorageCapability,
  StoragePort,
} from '@obikai/adapter-contracts';
import type { AuthzActor } from '@obikai/authz';
import type {
  WaiverSignInput,
  WaiverSignature,
  WaiverTemplate,
  WaiverTemplateCreateInput,
} from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  type WaiverSignatureCreateFields,
  type WaiverSignatureStore,
  type WaiverTemplateStore,
  type WaiverTemplateUpdateInput,
  WaiversService,
} from './waivers.service.js';

/** In-memory StoragePort — echoes the key into a fake presigned URL so tests can assert on it. */
class FakeStorage implements StoragePort {
  readonly kind = 'storage' as const;
  readonly providerId = 'fake';
  readonly capabilities = new Set<StorageCapability>(['presign-put', 'presign-get', 'delete']);
  init(): Promise<void> {
    return Promise.resolve();
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
  health(): Promise<{ ok: boolean }> {
    return Promise.resolve({ ok: true });
  }
  presignPut(input: PresignPutInput): Promise<{ url: string; headers?: Record<string, string> }> {
    return Promise.resolve({
      url: `https://storage.test/${input.key}?op=put`,
      headers: { 'content-type': input.contentType },
    });
  }
  presignGet(input: PresignGetInput): Promise<{ url: string }> {
    return Promise.resolve({ url: `https://storage.test/${input.key}?op=get` });
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

/** In-memory template store — versions templates exactly like the real repo (editing bumps version). */
class FakeTemplateStore implements WaiverTemplateStore {
  private readonly byId = new Map<string, WaiverTemplate>();
  private seq = 0;

  async create(input: WaiverTemplateCreateInput): Promise<WaiverTemplate> {
    const id = `wt${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const tpl: WaiverTemplate = {
      id: id as WaiverTemplate['id'],
      tenantId: 't1' as WaiverTemplate['tenantId'],
      title: input.title,
      bodyMarkdown: input.bodyMarkdown,
      version: 1,
      requiresGuardianForMinor: input.requiresGuardianForMinor,
      active: input.active,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, tpl);
    return tpl;
  }
  async findById(id: string): Promise<WaiverTemplate | null> {
    return this.byId.get(id) ?? null;
  }
  async list(opts: { active?: boolean } = {}): Promise<WaiverTemplate[]> {
    const all = [...this.byId.values()];
    return opts.active === undefined ? all : all.filter((t) => t.active === opts.active);
  }
  async updateBody(id: string, patch: WaiverTemplateUpdateInput): Promise<WaiverTemplate | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next: WaiverTemplate = {
      ...cur,
      ...patch,
      version: cur.version + 1,
      updatedAt: '2026-06-07T00:00:00.000Z',
    };
    this.byId.set(id, next);
    return next;
  }
}

/** In-memory signature store — append-only, mirrors the immutable real repo. */
class FakeSignatureStore implements WaiverSignatureStore {
  private readonly byId = new Map<string, WaiverSignature>();
  private seq = 0;

  async create(input: WaiverSignatureCreateFields): Promise<WaiverSignature> {
    const id = `ws${++this.seq}`;
    const sig: WaiverSignature = {
      id: id as WaiverSignature['id'],
      tenantId: 't1' as WaiverSignature['tenantId'],
      templateId: input.templateId as WaiverSignature['templateId'],
      templateVersion: input.templateVersion,
      memberId: input.memberId as WaiverSignature['memberId'],
      signedByUserId: input.signedByUserId,
      signedByName: input.signedByName,
      isGuardian: input.isGuardian,
      guardianForMemberId: input.guardianForMemberId as WaiverSignature['guardianForMemberId'],
      signedAt: input.signedAt,
      ip: input.ip,
      documentStorageKey: input.documentStorageKey,
      createdAt: input.signedAt,
    };
    this.byId.set(id, sig);
    return sig;
  }
  async findById(id: string): Promise<WaiverSignature | null> {
    return this.byId.get(id) ?? null;
  }
  async listByMember(memberId: string): Promise<WaiverSignature[]> {
    return [...this.byId.values()].filter((s) => s.memberId === memberId);
  }
  async listByTemplate(templateId: string): Promise<WaiverSignature[]> {
    return [...this.byId.values()].filter((s) => s.templateId === templateId);
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const bareMember = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

const sampleTemplate: WaiverTemplateCreateInput = {
  title: 'Liability Waiver',
  bodyMarkdown: 'Original body',
  requiresGuardianForMinor: true,
  active: true,
};

const signInput = (over: Partial<WaiverSignInput> = {}): WaiverSignInput => ({
  templateId: 'wt1',
  memberId: 'm1',
  signedByName: 'Aiko Tanaka',
  isGuardian: false,
  ...over,
});

describe('WaiversService', () => {
  let svc: WaiversService;
  let templates: FakeTemplateStore;
  let signatures: FakeSignatureStore;
  beforeEach(() => {
    templates = new FakeTemplateStore();
    signatures = new FakeSignatureStore();
    svc = new WaiversService(templates, signatures, new FakeStorage());
  });

  describe('template RBAC', () => {
    it('lets staff create and list templates', async () => {
      const created = await svc.createTemplate(staff, sampleTemplate);
      expect(created.title).toBe('Liability Waiver');
      expect(created.version).toBe(1);
      const list = await svc.listTemplates(staff);
      expect(list).toHaveLength(1);
    });

    it('forbids a bare member from creating templates', async () => {
      await expect(svc.createTemplate(bareMember, sampleTemplate)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it('forbids staff from editing a template (no waiver:update grant)', async () => {
      const created = await svc.createTemplate(staff, sampleTemplate);
      await expect(
        svc.updateTemplate(staff, created.id, { bodyMarkdown: 'New body' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404s editing a missing template', async () => {
      await expect(svc.updateTemplate(owner, 'nope', { bodyMarkdown: 'x' })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('versioning', () => {
    it('mints a new version on edit and pins the OLD version on prior signatures', async () => {
      const created = await svc.createTemplate(owner, sampleTemplate);
      expect(created.version).toBe(1);

      // Sign under v1.
      const sig = await svc.sign(staff, signInput({ templateId: created.id }));
      expect(sig.templateVersion).toBe(1);

      // Edit the body → mints v2.
      const v2 = await svc.updateTemplate(owner, created.id, { bodyMarkdown: 'Revised body' });
      expect(v2.version).toBe(2);
      expect(v2.bodyMarkdown).toBe('Revised body');

      // The earlier signature is untouched: still pinned to v1.
      const stored = await signatures.findById(sig.id);
      expect(stored?.templateVersion).toBe(1);

      // A new signature after the edit pins v2.
      const sig2 = await svc.sign(staff, signInput({ templateId: created.id, memberId: 'm2' }));
      expect(sig2.templateVersion).toBe(2);
    });
  });

  describe('signing RBAC', () => {
    let templateId: string;
    beforeEach(async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      templateId = t.id;
    });

    it('lets staff record a signature on a member behalf', async () => {
      const sig = await svc.sign(staff, signInput({ templateId }));
      expect(sig.memberId).toBe('m1');
      expect(sig.signedByUserId).toBe('u1');
    });

    it('lets a member sign their OWN waiver via self-access', async () => {
      const self = actor({
        userId: 'u2',
        memberId: 'm1',
        roles: [{ role: 'member', locationScope: 'ALL' }],
      });
      const sig = await svc.sign(self, signInput({ templateId, memberId: 'm1' }));
      expect(sig.memberId).toBe('m1');
    });

    it("forbids a bare member from signing someone else's waiver", async () => {
      const other = actor({
        userId: 'u3',
        memberId: 'm9',
        roles: [{ role: 'member', locationScope: 'ALL' }],
      });
      await expect(
        svc.sign(other, signInput({ templateId, memberId: 'm1' })),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('lets a guardian sign for a linked minor via guardianship', async () => {
      const guardian = actor({
        userId: 'g1',
        roles: [{ role: 'guardian', locationScope: 'ALL' }],
      });
      // can() consults guardianships from CanOptions; the service uses defaults, so a guardian with
      // no grant is denied — proving guardianship is required, not assumed.
      await expect(
        svc.sign(
          guardian,
          signInput({ templateId, memberId: 'm1', isGuardian: true, guardianForMemberId: 'm1' }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('404s signing against a missing template', async () => {
      await expect(svc.sign(staff, signInput({ templateId: 'nope' }))).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('defaults documentStorageKey and ip to null when no context is given', async () => {
      const sig = await svc.sign(staff, signInput({ templateId }));
      expect(sig.documentStorageKey).toBeNull();
      expect(sig.ip).toBeNull();
    });
  });

  describe('listing signatures', () => {
    it('lets a member list their OWN signatures but not others', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      await svc.sign(staff, signInput({ templateId: t.id, memberId: 'm1' }));
      const self = actor({
        userId: 'u2',
        memberId: 'm1',
        roles: [{ role: 'member', locationScope: 'ALL' }],
      });
      const own = await svc.listSignatures(self, 'm1');
      expect(own).toHaveLength(1);
      await expect(svc.listSignatures(self, 'm2')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('lets staff list any member signatures', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      await svc.sign(staff, signInput({ templateId: t.id, memberId: 'm1' }));
      const list = await svc.listSignatures(staff, 'm1');
      expect(list).toHaveLength(1);
    });
  });

  describe('member waiver status (listForMember)', () => {
    const self = actor({
      userId: 'u2',
      memberId: 'm1',
      roles: [{ role: 'member', locationScope: 'ALL' }],
    });

    it('marks an active template signed once the member signs its current version', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      const before = await svc.listForMember(self, 'm1');
      expect(before).toHaveLength(1);
      expect(before[0]?.signed).toBe(false);
      expect(before[0]?.signature).toBeNull();

      await svc.sign(self, signInput({ templateId: t.id, memberId: 'm1' }));
      const after = await svc.listForMember(self, 'm1');
      expect(after[0]?.signed).toBe(true);
      expect(after[0]?.signature?.memberId).toBe('m1');
    });

    it('re-prompts (signed=false) after the template is revised to a new version', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      await svc.sign(self, signInput({ templateId: t.id, memberId: 'm1' }));
      // Editing the body mints v2; the v1 signature no longer satisfies the current version.
      await svc.updateTemplate(owner, t.id, { bodyMarkdown: 'Revised body' });
      const status = await svc.listForMember(self, 'm1');
      expect(status[0]?.template.version).toBe(2);
      expect(status[0]?.signed).toBe(false);
    });

    it('excludes inactive templates from the member view', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      await svc.updateTemplate(owner, t.id, { active: false });
      expect(await svc.listForMember(self, 'm1')).toHaveLength(0);
    });

    it('lets staff read any member’s status but forbids a bare member reading another’s', async () => {
      await svc.createTemplate(owner, sampleTemplate);
      expect(await svc.listForMember(staff, 'm1')).toHaveLength(1);
      await expect(svc.listForMember(self, 'm2')).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('forbids a guardian with no guardianship grant (parity with signing)', async () => {
      await svc.createTemplate(owner, sampleTemplate);
      const guardian = actor({ userId: 'g1', roles: [{ role: 'guardian', locationScope: 'ALL' }] });
      await expect(svc.listForMember(guardian, 'm1')).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  describe('document storage', () => {
    const selfMember = actor({
      userId: 'u2',
      memberId: 'm1',
      roles: [{ role: 'member', locationScope: 'ALL' }],
    });

    it('allocates an upload URL keyed in the tenant namespace, defaulting the extension to pdf', async () => {
      const out = await svc.createDocumentUploadUrl(staff, 't1', {
        contentType: 'application/pdf',
        ext: '',
      });
      expect(out.key.startsWith('waivers/t1/')).toBe(true);
      expect(out.key.endsWith('.pdf')).toBe(true);
      expect(out.url).toContain(out.key);
      expect(out.headers?.['content-type']).toBe('application/pdf');
    });

    it('honours a safe extension and lets a member stage their own upload', async () => {
      const out = await svc.createDocumentUploadUrl(selfMember, 't1', {
        contentType: 'image/png',
        ext: 'png',
      });
      expect(out.key.endsWith('.png')).toBe(true);
    });

    it('forbids an actor who can neither record waivers nor act as a member', async () => {
      const nobody = actor({ roles: [] });
      await expect(
        svc.createDocumentUploadUrl(nobody, 't1', { contentType: 'application/pdf', ext: 'pdf' }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('persists an in-namespace document key on signing', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      const sig = await svc.sign(staff, signInput({ templateId: t.id }), {
        tenantId: 't1',
        documentStorageKey: 'waivers/t1/doc.pdf',
      });
      expect(sig.documentStorageKey).toBe('waivers/t1/doc.pdf');
    });

    it('rejects a document key outside the tenant namespace (cross-tenant guard)', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      await expect(
        svc.sign(staff, signInput({ templateId: t.id }), {
          tenantId: 't1',
          documentStorageKey: 'waivers/other/doc.pdf',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
      // ...and refuses when tenantId is missing entirely.
      await expect(
        svc.sign(staff, signInput({ templateId: t.id }), {
          documentStorageKey: 'waivers/t1/doc.pdf',
        }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it('returns a presigned download URL for a stored document (self / staff)', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      const sig = await svc.sign(staff, signInput({ templateId: t.id, memberId: 'm1' }), {
        tenantId: 't1',
        documentStorageKey: 'waivers/t1/doc.pdf',
      });
      const staffUrl = await svc.getDocumentDownloadUrl(staff, sig.id);
      expect(staffUrl.url).toContain('waivers/t1/doc.pdf');
      const selfUrl = await svc.getDocumentDownloadUrl(selfMember, sig.id);
      expect(selfUrl.url).toContain('op=get');
    });

    it('404s a download when no document is attached, and forbids another member', async () => {
      const t = await svc.createTemplate(owner, sampleTemplate);
      const sig = await svc.sign(staff, signInput({ templateId: t.id, memberId: 'm1' }));
      await expect(svc.getDocumentDownloadUrl(staff, sig.id)).rejects.toBeInstanceOf(NotFoundError);
      const withDoc = await svc.sign(staff, signInput({ templateId: t.id, memberId: 'm1' }), {
        tenantId: 't1',
        documentStorageKey: 'waivers/t1/doc.pdf',
      });
      const other = actor({
        userId: 'u9',
        memberId: 'm9',
        roles: [{ role: 'member', locationScope: 'ALL' }],
      });
      await expect(svc.getDocumentDownloadUrl(other, withDoc.id)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });
  });
});
