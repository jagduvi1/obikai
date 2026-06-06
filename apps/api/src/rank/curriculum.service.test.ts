import type { AuthzActor } from '@obikai/authz';
import type { CurriculumCompletion, CurriculumItem } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  type CurriculumCompletionsStore,
  type CurriculumItemsStore,
  CurriculumService,
  ForbiddenError,
  NotFoundError,
} from './curriculum.service.js';

class FakeItems implements CurriculumItemsStore {
  readonly byId = new Map<string, CurriculumItem>();
  private seq = 0;
  async create(input: {
    disciplineId: string;
    itemKey: string;
    label: string;
    description?: string | null;
    mediaRef?: string | null;
  }): Promise<CurriculumItem> {
    const id = `ci${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const item: CurriculumItem = {
      id: id as CurriculumItem['id'],
      tenantId: 't1' as CurriculumItem['tenantId'],
      disciplineId: input.disciplineId as CurriculumItem['disciplineId'],
      itemKey: input.itemKey,
      label: input.label,
      description: input.description ?? null,
      mediaRef: input.mediaRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, item);
    return item;
  }
  async findById(id: string): Promise<CurriculumItem | null> {
    return this.byId.get(id) ?? null;
  }
  async list(opts: { disciplineId?: string } = {}): Promise<CurriculumItem[]> {
    return [...this.byId.values()].filter((i) =>
      opts.disciplineId ? i.disciplineId === opts.disciplineId : true,
    );
  }
  async update(
    id: string,
    patch: { label?: string; description?: string | null; mediaRef?: string | null },
  ): Promise<CurriculumItem | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as CurriculumItem;
    this.byId.set(id, next);
    return next;
  }
}

class FakeCompletions implements CurriculumCompletionsStore {
  readonly rows: CurriculumCompletion[] = [];
  async mark(input: {
    memberId: string;
    disciplineId: string;
    itemKey: string;
    completedAt: string;
    markedByUserId: string;
  }): Promise<CurriculumCompletion> {
    const key = (r: { memberId: string; disciplineId: string; itemKey: string }) =>
      `${r.memberId}|${r.disciplineId}|${r.itemKey}`;
    const idx = this.rows.findIndex((r) => key(r) === key(input));
    const rec: CurriculumCompletion = {
      id: `cc${this.rows.length + 1}` as CurriculumCompletion['id'],
      tenantId: 't1' as CurriculumCompletion['tenantId'],
      memberId: input.memberId as CurriculumCompletion['memberId'],
      disciplineId: input.disciplineId as CurriculumCompletion['disciplineId'],
      itemKey: input.itemKey,
      completedAt: input.completedAt,
      markedByUserId: input.markedByUserId,
    };
    if (idx >= 0) this.rows[idx] = { ...rec, id: this.rows[idx]!.id };
    else this.rows.push(rec);
    return rec;
  }
  async unmark(memberId: string, disciplineId: string, itemKey: string): Promise<boolean> {
    const idx = this.rows.findIndex(
      (r) => r.memberId === memberId && r.disciplineId === disciplineId && r.itemKey === itemKey,
    );
    if (idx < 0) return false;
    this.rows.splice(idx, 1);
    return true;
  }
  async listByMemberDiscipline(
    memberId: string,
    disciplineId: string,
  ): Promise<CurriculumCompletion[]> {
    return this.rows.filter((r) => r.memberId === memberId && r.disciplineId === disciplineId);
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const instructor = actor({
  userId: 'inst1',
  roles: [{ role: 'instructor', locationScope: 'ALL' }],
});
const selfMember = actor({ memberId: 'm1', roles: [{ role: 'member', locationScope: 'ALL' }] });
const otherMember = actor({ memberId: 'm2', roles: [{ role: 'member', locationScope: 'ALL' }] });
const CLOCK = () => new Date('2026-06-06T12:00:00.000Z');

const make = () => {
  const items = new FakeItems();
  const completions = new FakeCompletions();
  return { svc: new CurriculumService(items, completions, CLOCK), items, completions };
};

describe('CurriculumService items', () => {
  it('instructor authors, lists, and updates items', async () => {
    const { svc } = make();
    const item = await svc.createItem(instructor, {
      disciplineId: 'disc1',
      itemKey: 'armbar',
      label: 'Armbar',
    });
    expect(item.itemKey).toBe('armbar');
    expect(await svc.listItems(instructor, { disciplineId: 'disc1' })).toHaveLength(1);
    const updated = await svc.updateItem(instructor, item.id, { label: 'Juji-gatame' });
    expect(updated.label).toBe('Juji-gatame');
  });

  it('updateItem throws NotFound for a missing item', async () => {
    const { svc } = make();
    await expect(svc.updateItem(instructor, 'nope', { label: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('denies a member from authoring', async () => {
    const { svc } = make();
    await expect(
      svc.createItem(selfMember, { disciplineId: 'd', itemKey: 'k', label: 'L' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('CurriculumService completions', () => {
  it('marks idempotently and unmarks', async () => {
    const { svc, completions } = make();
    await svc.markComplete(instructor, {
      memberId: 'm1',
      disciplineId: 'disc1',
      itemKey: 'armbar',
    });
    await svc.markComplete(instructor, {
      memberId: 'm1',
      disciplineId: 'disc1',
      itemKey: 'armbar',
    });
    expect(completions.rows).toHaveLength(1);
    expect(completions.rows[0]?.markedByUserId).toBe('inst1');
    await svc.unmarkComplete(instructor, {
      memberId: 'm1',
      disciplineId: 'disc1',
      itemKey: 'armbar',
    });
    expect(completions.rows).toHaveLength(0);
  });

  it('unmark throws NotFound when nothing is marked', async () => {
    const { svc } = make();
    await expect(
      svc.unmarkComplete(instructor, { memberId: 'm1', disciplineId: 'disc1', itemKey: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a member reads their OWN completions but not another member’s', async () => {
    const { svc } = make();
    await svc.markComplete(instructor, {
      memberId: 'm1',
      disciplineId: 'disc1',
      itemKey: 'armbar',
    });
    expect(await svc.listCompletions(selfMember, 'm1', 'disc1')).toHaveLength(1);
    await expect(svc.listCompletions(otherMember, 'm1', 'disc1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('a member cannot mark completions (instructor-verified)', async () => {
    const { svc } = make();
    await expect(
      svc.markComplete(selfMember, { memberId: 'm1', disciplineId: 'disc1', itemKey: 'armbar' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
