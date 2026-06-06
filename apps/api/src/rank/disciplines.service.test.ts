import type { AuthzActor } from '@obikai/authz';
import type { Discipline, PresentationStyle } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  DisciplinesService,
  type DisciplinesStore,
  ForbiddenError,
  NotFoundError,
} from './disciplines.service.js';

class FakeStore implements DisciplinesStore {
  readonly byId = new Map<string, Discipline>();
  private seq = 0;
  async create(input: {
    name: string;
    description?: string | null;
    presentation?: PresentationStyle;
    active?: boolean;
  }): Promise<Discipline> {
    const id = `d${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const d: Discipline = {
      id: id as Discipline['id'],
      tenantId: 't1' as Discipline['tenantId'],
      name: input.name,
      description: input.description ?? null,
      presentation: input.presentation ?? 'belt',
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, d);
    return d;
  }
  async findById(id: string): Promise<Discipline | null> {
    return this.byId.get(id) ?? null;
  }
  async list(opts: { active?: boolean } = {}): Promise<Discipline[]> {
    let all = [...this.byId.values()];
    if (opts.active !== undefined) all = all.filter((d) => d.active === opts.active);
    return all;
  }
  async update(
    id: string,
    patch: {
      name?: string;
      description?: string | null;
      presentation?: PresentationStyle;
      active?: boolean;
    },
  ): Promise<Discipline | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Discipline;
    this.byId.set(id, next);
    return next;
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

describe('DisciplinesService', () => {
  it('owner creates, lists, gets, and updates', async () => {
    const svc = new DisciplinesService(new FakeStore());
    const d = await svc.create(owner, { name: 'BJJ', presentation: 'belt', active: true });
    expect(d.name).toBe('BJJ');
    expect(await svc.get(owner, d.id)).toEqual(d);
    const updated = await svc.update(owner, d.id, { active: false });
    expect(updated.active).toBe(false);
    expect(await svc.list(owner)).toHaveLength(1);
  });

  it('instructor may read/list but NOT create or update', async () => {
    const store = new FakeStore();
    const svc = new DisciplinesService(store);
    const d = await svc.create(owner, { name: 'Judo', presentation: 'belt', active: true });
    expect((await svc.list(instructor)).map((x) => x.name)).toEqual(['Judo']);
    expect(await svc.get(instructor, d.id)).toBeTruthy();
    await expect(
      svc.create(instructor, { name: 'X', presentation: 'belt', active: true }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.update(instructor, d.id, { active: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('a bare member is denied (no discipline grant)', async () => {
    const svc = new DisciplinesService(new FakeStore());
    await expect(svc.list(member)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('get/update throw NotFound for a missing discipline', async () => {
    const svc = new DisciplinesService(new FakeStore());
    await expect(svc.get(owner, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.update(owner, 'nope', { active: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
