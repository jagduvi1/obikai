/**
 * Rank/grading/curriculum persistence tests (ADR-0005/0015) against an in-memory MongoDB. Focus:
 * version + promotion IMMUTABILITY/append-only, per-(member,discipline) uniqueness, idempotent
 * grading/curriculum records, and tenant isolation. Requires a `mongodb-memory-server` binary.
 */
import type { CriterionEvaluation, ProgressionSystemVersion } from '@obikai/domain';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CurriculumCompletionRepository,
  CurriculumItemRepository,
  DisciplineRepository,
  DuplicateVersionError,
  GradingEventRepository,
  GradingResultRepository,
  MemberRankStateRepository,
  PromotionRepository,
  RankSystemRepository,
} from '../src/rank.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'owner', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const disciplines = new DisciplineRepository();
const systems = new RankSystemRepository();
const states = new MemberRankStateRepository();
const promotions = new PromotionRepository();
const gradingEvents = new GradingEventRepository();
const gradingResults = new GradingResultRepository();
const curriculumItems = new CurriculumItemRepository();
const completions = new CurriculumCompletionRepository();

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    mongoose.model('Discipline').syncIndexes(),
    mongoose.model('ProgressionSystem').syncIndexes(),
    mongoose.model('ProgressionSystemVersion').syncIndexes(),
    mongoose.model('MemberRankState').syncIndexes(),
    mongoose.model('Promotion').syncIndexes(),
    mongoose.model('GradingEvent').syncIndexes(),
    mongoose.model('GradingResult').syncIndexes(),
    mongoose.model('CurriculumItem').syncIndexes(),
    mongoose.model('CurriculumCompletion').syncIndexes(),
  ]);
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  const c = mongoose.connection;
  await Promise.all([
    c.collection('disciplines').deleteMany({}),
    c.collection('progressionsystems').deleteMany({}),
    c.collection('progressionsystemversions').deleteMany({}),
    c.collection('memberrankstates').deleteMany({}),
    c.collection('promotions').deleteMany({}),
    c.collection('gradingevents').deleteMany({}),
    c.collection('gradingresults').deleteMany({}),
    c.collection('curriculumitems').deleteMany({}),
    c.collection('curriculumcompletions').deleteMany({}),
  ]);
});

/** A minimal version (nested config is stored opaquely, so shape detail is irrelevant here). */
const version = (systemId: string, versionId: string, v: number): ProgressionSystemVersion =>
  ({
    systemId,
    versionId,
    version: v,
    disciplineId: 'disc1',
    presentation: 'belt',
    tracks: [],
    ladder: [],
    transitions: [],
    curricula: [],
    contentHash: `hash-${versionId}`,
  }) as unknown as ProgressionSystemVersion;

describe('DisciplineRepository', () => {
  it('creates, lists active, and isolates per tenant', async () => {
    await runInTenantContext(ctx('t1'), () => disciplines.create({ name: { en: 'BJJ' } }));
    await runInTenantContext(ctx('t1'), () =>
      disciplines.create({ name: { en: 'Judo' }, active: false }),
    );
    await runInTenantContext(ctx('t2'), () => disciplines.create({ name: { en: 'Karate' } }));

    const t1all = await runInTenantContext(ctx('t1'), () => disciplines.list());
    expect(t1all.map((d) => d.name.en).sort()).toEqual(['BJJ', 'Judo']);
    const t1active = await runInTenantContext(ctx('t1'), () => disciplines.list({ active: true }));
    expect(t1active.map((d) => d.name.en)).toEqual(['BJJ']);
    // Tenant isolation: t2 never sees t1's disciplines.
    const t2all = await runInTenantContext(ctx('t2'), () => disciplines.list());
    expect(t2all.map((d) => d.name.en)).toEqual(['Karate']);
  });
});

describe('RankSystemRepository (version immutability)', () => {
  it('publishVersion stores the version and points the handle at it', async () => {
    await runInTenantContext(ctx('t1'), () => systems.publishVersion(version('sys1', 'v1', 1)));
    const sys = await runInTenantContext(ctx('t1'), () => systems.getSystem('sys1'));
    expect(sys?.currentVersionId).toBe('v1');
    expect(sys?.versionIds).toEqual(['v1']);
    const current = await runInTenantContext(ctx('t1'), () => systems.getCurrentVersion('sys1'));
    expect(current?.versionId).toBe('v1');
  });

  it('a new version advances current and appends to versionIds', async () => {
    await runInTenantContext(ctx('t1'), () => systems.publishVersion(version('sys1', 'v1', 1)));
    await runInTenantContext(ctx('t1'), () => systems.publishVersion(version('sys1', 'v2', 2)));
    const sys = await runInTenantContext(ctx('t1'), () => systems.getSystem('sys1'));
    expect(sys?.currentVersionId).toBe('v2');
    expect(sys?.versionIds.sort()).toEqual(['v1', 'v2']);
    const all = await runInTenantContext(ctx('t1'), () => systems.listVersions('sys1'));
    expect(all.map((x) => x.version)).toEqual([1, 2]);
  });

  it('rejects re-publishing an existing versionId (immutability)', async () => {
    await runInTenantContext(ctx('t1'), () => systems.publishVersion(version('sys1', 'v1', 1)));
    await expect(
      runInTenantContext(ctx('t1'), () => systems.publishVersion(version('sys1', 'v1', 1))),
    ).rejects.toBeInstanceOf(DuplicateVersionError);
  });
});

describe('MemberRankStateRepository', () => {
  const base = {
    disciplineId: 'disc1',
    systemId: 'sys1',
    trackId: 'trk1',
    enteredCurrentStepAt: '2026-01-01',
  };

  it('enforces one state per (member, discipline) and advances on update', async () => {
    const st = await runInTenantContext(ctx('t1'), () =>
      states.create({ memberId: 'm1', ...base, currentStepId: null }),
    );
    expect(st.currentStepId).toBeNull();
    // Duplicate (member, discipline) rejected.
    await expect(
      runInTenantContext(ctx('t1'), () => states.create({ memberId: 'm1', ...base })),
    ).rejects.toThrow();
    // Advance.
    const advanced = await runInTenantContext(ctx('t1'), () =>
      states.update(st.id, { currentStepId: 'step1', enteredCurrentStepAt: '2026-02-01' }),
    );
    expect(advanced?.currentStepId).toBe('step1');
    const found = await runInTenantContext(ctx('t1'), () =>
      states.findByMemberDiscipline('m1', 'disc1'),
    );
    expect(found?.currentStepId).toBe('step1');
  });
});

describe('PromotionRepository (append-only history)', () => {
  const snap: CriterionEvaluation[] = [];
  const promo = (toStepId: string, awardedAt: string) => ({
    memberId: 'm1',
    disciplineId: 'disc1',
    systemId: 'sys1',
    systemVersionId: 'v1',
    fromStepId: null,
    toStepId,
    awardedAt,
    awardedByRole: 'instructor' as const,
    awardingUserId: 'u1',
    satisfiedSnapshot: snap,
  });

  it('appends entries and lists them newest-first', async () => {
    await runInTenantContext(ctx('t1'), () =>
      promotions.create(promo('step1', '2026-01-01T00:00:00.000Z')),
    );
    await runInTenantContext(ctx('t1'), () =>
      promotions.create(promo('step2', '2026-06-01T00:00:00.000Z')),
    );
    const hist = await runInTenantContext(ctx('t1'), () => promotions.list({ memberId: 'm1' }));
    expect(hist.map((p) => p.toStepId)).toEqual(['step2', 'step1']); // desc by awardedAt
    // Tenant isolation.
    const t2 = await runInTenantContext(ctx('t2'), () => promotions.list({ memberId: 'm1' }));
    expect(t2).toEqual([]);
  });
});

describe('GradingResultRepository (idempotent record)', () => {
  it('re-recording the same (event, member, step) overwrites instead of duplicating', async () => {
    const ev = await runInTenantContext(ctx('t1'), () =>
      gradingEvents.create({
        disciplineId: 'disc1',
        name: 'Spring grading',
        scheduledAt: '2026-06-01T10:00:00.000Z',
      }),
    );
    await runInTenantContext(ctx('t1'), () =>
      gradingResults.record({
        gradingEventId: ev.id,
        memberId: 'm1',
        stepId: 'step1',
        passed: false,
        recordedByUserId: 'u1',
        recordedAt: '2026-06-01T11:00:00.000Z',
      }),
    );
    // Corrected result for the same coordinates.
    await runInTenantContext(ctx('t1'), () =>
      gradingResults.record({
        gradingEventId: ev.id,
        memberId: 'm1',
        stepId: 'step1',
        passed: true,
        recordedByUserId: 'u2',
        recordedAt: '2026-06-01T12:00:00.000Z',
      }),
    );
    const results = await runInTenantContext(ctx('t1'), () => gradingResults.listByEvent(ev.id));
    expect(results).toHaveLength(1);
    expect(results[0]?.passed).toBe(true);
  });
});

describe('CurriculumCompletionRepository (idempotent mark)', () => {
  it('marks once, unmarks, and lists per member+discipline', async () => {
    await runInTenantContext(ctx('t1'), () =>
      completions.mark({
        memberId: 'm1',
        disciplineId: 'disc1',
        itemKey: 'armbar',
        completedAt: '2026-06-01T00:00:00.000Z',
        markedByUserId: 'u1',
      }),
    );
    // Re-mark is idempotent (no duplicate row).
    await runInTenantContext(ctx('t1'), () =>
      completions.mark({
        memberId: 'm1',
        disciplineId: 'disc1',
        itemKey: 'armbar',
        completedAt: '2026-06-02T00:00:00.000Z',
        markedByUserId: 'u2',
      }),
    );
    let list = await runInTenantContext(ctx('t1'), () =>
      completions.listByMemberDiscipline('m1', 'disc1'),
    );
    expect(list).toHaveLength(1);
    expect(list[0]?.markedByUserId).toBe('u2');
    // Unmark.
    const removed = await runInTenantContext(ctx('t1'), () =>
      completions.unmark('m1', 'disc1', 'armbar'),
    );
    expect(removed).toBe(true);
    list = await runInTenantContext(ctx('t1'), () =>
      completions.listByMemberDiscipline('m1', 'disc1'),
    );
    expect(list).toHaveLength(0);
  });
});

describe('CurriculumItemRepository', () => {
  it('enforces unique itemKey per discipline within a tenant', async () => {
    await runInTenantContext(ctx('t1'), () =>
      curriculumItems.create({ disciplineId: 'disc1', itemKey: 'armbar', label: { en: 'Armbar' } }),
    );
    await expect(
      runInTenantContext(ctx('t1'), () =>
        curriculumItems.create({
          disciplineId: 'disc1',
          itemKey: 'armbar',
          label: { en: 'Armbar 2' },
        }),
      ),
    ).rejects.toThrow();
    // Same key under a different discipline is fine.
    const ok = await runInTenantContext(ctx('t1'), () =>
      curriculumItems.create({ disciplineId: 'disc2', itemKey: 'armbar', label: { en: 'Armbar' } }),
    );
    expect(ok.id).toBeTruthy();
  });
});
