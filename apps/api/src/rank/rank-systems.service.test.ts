import type { AuthzActor } from '@obikai/authz';
import type { ProgressionSystem, ProgressionSystemVersion } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  NotFoundError,
  RankSystemsService,
  type RankSystemsStore,
  ValidationFailedError,
} from './rank-systems.service.js';

/** In-memory store keyed by versionId + a per-systemId handle. */
class FakeStore implements RankSystemsStore {
  readonly versions = new Map<string, ProgressionSystemVersion>();
  readonly systems = new Map<string, ProgressionSystem>();

  async publishVersion(version: ProgressionSystemVersion): Promise<ProgressionSystemVersion> {
    this.versions.set(version.versionId, version);
    const existing = this.systems.get(version.systemId);
    this.systems.set(version.systemId, {
      id: version.systemId,
      disciplineId: version.disciplineId,
      currentVersionId: version.versionId,
      versionIds: [...(existing?.versionIds ?? []), version.versionId],
    });
    return version;
  }
  async getCurrentVersion(systemId: string): Promise<ProgressionSystemVersion | null> {
    const sys = this.systems.get(systemId);
    return sys ? (this.versions.get(sys.currentVersionId) ?? null) : null;
  }
  async getVersion(versionId: string): Promise<ProgressionSystemVersion | null> {
    return this.versions.get(versionId) ?? null;
  }
  async listVersions(systemId: string): Promise<ProgressionSystemVersion[]> {
    return [...this.versions.values()]
      .filter((v) => v.systemId === systemId)
      .sort((a, b) => a.version - b.version);
  }
  async getSystem(systemId: string): Promise<ProgressionSystem | null> {
    return this.systems.get(systemId) ?? null;
  }
  async findSystemByDiscipline(disciplineId: string): Promise<ProgressionSystem | null> {
    return [...this.systems.values()].find((s) => s.disciplineId === disciplineId) ?? null;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const instructor = actor({ roles: [{ role: 'instructor', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

/** A minimal valid two-step config the pure engine accepts (mirrors the engine's own fixtures). */
const validConfig = (count = 100) => ({
  disciplineId: 'bjj',
  systemId: 'bjj-adult',
  presentation: 'belt',
  tracks: [{ id: 'adult' }],
  ladder: [
    {
      id: 'white',
      kind: 'rank',
      order: 0,
      trackId: 'adult',
      visual: { primaryColor: '#ffffff' },
      criteria: { type: 'allOf', criteria: [] },
    },
    {
      id: 'blue',
      kind: 'rank',
      order: 10,
      trackId: 'adult',
      visual: { primaryColor: '#0000ff' },
      criteria: { type: 'minClassesSinceLastPromotion', enforcement: 'required', count },
    },
  ],
  transitions: [],
  curricula: [],
});

describe('RankSystemsService.validate', () => {
  it('returns valid for a well-formed config', async () => {
    const svc = new RankSystemsService(new FakeStore());
    const res = await svc.validate(owner, validConfig());
    expect(res.valid).toBe(true);
  });
  it('returns invalid (with issues) for garbage', async () => {
    const svc = new RankSystemsService(new FakeStore());
    const res = await svc.validate(owner, { nonsense: true });
    expect(res.valid).toBe(false);
    if (!res.valid) expect(res.errors.length).toBeGreaterThan(0);
  });
  it('denies an actor without rankSystem:read', async () => {
    const svc = new RankSystemsService(new FakeStore());
    await expect(svc.validate(member, validConfig())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('RankSystemsService.publish', () => {
  it('mints + persists v1, then a re-publish mints v2 and advances current', async () => {
    const store = new FakeStore();
    const svc = new RankSystemsService(store);
    const v1 = await svc.publish(owner, validConfig(100));
    expect(v1.version).toBe(1);
    expect(v1.contentHash).toBeTruthy();
    expect(await svc.getCurrentVersion(owner, 'bjj-adult')).toMatchObject({
      versionId: v1.versionId,
    });

    // Editing the config (different content) mints v2 and advances the handle.
    const v2 = await svc.publish(owner, validConfig(120));
    expect(v2.version).toBe(2);
    expect(v2.versionId).not.toBe(v1.versionId);
    const current = await svc.getCurrentVersion(owner, 'bjj-adult');
    expect(current?.versionId).toBe(v2.versionId);
    expect((await svc.listVersions(owner, 'bjj-adult')).map((v) => v.version)).toEqual([1, 2]);
  });

  it('throws ValidationFailedError for an invalid config', async () => {
    const svc = new RankSystemsService(new FakeStore());
    await expect(svc.publish(owner, { bad: true })).rejects.toBeInstanceOf(ValidationFailedError);
  });

  it('denies an instructor (read-only on rankSystem)', async () => {
    const svc = new RankSystemsService(new FakeStore());
    await expect(svc.publish(instructor, validConfig())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('getCurrentVersion throws NotFound for an unknown system', async () => {
    const svc = new RankSystemsService(new FakeStore());
    await expect(svc.getCurrentVersion(owner, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});
