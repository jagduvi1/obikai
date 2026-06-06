import { type AuthzActor, can } from '@obikai/authz';
import type {
  CurriculumCompletion,
  CurriculumItem,
  CurriculumItemCreateInput,
} from '@obikai/domain';

/**
 * CurriculumService — authoring curriculum items (the engine's opaque item keys given human labels/
 * media) and tracking per-student completion (ADR-0015). Item authoring is gated on the `curriculum`
 * resource (instructor/owner); completions are recorded by instructors and a member may read their
 * OWN via self-access. Completions feed the engine's `completedCurriculumItemIds` (via
 * PromotionsService). Framework-free; tenant scoping via TenantContext.
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export interface CurriculumItemsStore {
  create(input: {
    disciplineId: string;
    itemKey: string;
    label: string;
    description?: string | null;
    mediaRef?: string | null;
  }): Promise<CurriculumItem>;
  findById(id: string): Promise<CurriculumItem | null>;
  list(opts?: { disciplineId?: string }): Promise<CurriculumItem[]>;
  update(
    id: string,
    patch: { label?: string; description?: string | null; mediaRef?: string | null },
  ): Promise<CurriculumItem | null>;
}

export interface CurriculumCompletionsStore {
  mark(input: {
    memberId: string;
    disciplineId: string;
    itemKey: string;
    completedAt: string;
    markedByUserId: string;
  }): Promise<CurriculumCompletion>;
  unmark(memberId: string, disciplineId: string, itemKey: string): Promise<boolean>;
  listByMemberDiscipline(memberId: string, disciplineId: string): Promise<CurriculumCompletion[]>;
}

export interface CurriculumItemUpdateInput {
  label?: string;
  description?: string | null;
  mediaRef?: string | null;
}

export class CurriculumService {
  constructor(
    private readonly items: CurriculumItemsStore,
    private readonly completions: CurriculumCompletionsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createItem(actor: AuthzActor, input: CurriculumItemCreateInput): Promise<CurriculumItem> {
    if (!can(actor, { resource: 'curriculum', action: 'update' }))
      throw new ForbiddenError('update', 'curriculum');
    return this.items.create({
      disciplineId: input.disciplineId,
      itemKey: input.itemKey,
      label: input.label,
      description: input.description ?? null,
      mediaRef: input.mediaRef ?? null,
    });
  }

  async listItems(
    actor: AuthzActor,
    opts: { disciplineId?: string } = {},
  ): Promise<CurriculumItem[]> {
    if (!can(actor, { resource: 'curriculum', action: 'list' }))
      throw new ForbiddenError('list', 'curriculum');
    return this.items.list(opts);
  }

  async updateItem(
    actor: AuthzActor,
    id: string,
    patch: CurriculumItemUpdateInput,
  ): Promise<CurriculumItem> {
    if (!can(actor, { resource: 'curriculum', action: 'update' }))
      throw new ForbiddenError('update', 'curriculum');
    const updated = await this.items.update(id, patch);
    if (!updated) throw new NotFoundError('curriculumItem', id);
    return updated;
  }

  /** Mark a student's curriculum item complete (instructor/owner). Idempotent. */
  async markComplete(
    actor: AuthzActor,
    input: { memberId: string; disciplineId: string; itemKey: string },
  ): Promise<CurriculumCompletion> {
    if (!can(actor, { resource: 'curriculum', action: 'update' }))
      throw new ForbiddenError('update', 'curriculum');
    return this.completions.mark({
      memberId: input.memberId,
      disciplineId: input.disciplineId,
      itemKey: input.itemKey,
      completedAt: this.now().toISOString(),
      markedByUserId: actor.userId,
    });
  }

  async unmarkComplete(
    actor: AuthzActor,
    input: { memberId: string; disciplineId: string; itemKey: string },
  ): Promise<void> {
    if (!can(actor, { resource: 'curriculum', action: 'update' }))
      throw new ForbiddenError('update', 'curriculum');
    const ok = await this.completions.unmark(input.memberId, input.disciplineId, input.itemKey);
    if (!ok) throw new NotFoundError('curriculumCompletion', `${input.memberId}/${input.itemKey}`);
  }

  /** A member's completions in a discipline; members may read their OWN via self-access. */
  async listCompletions(
    actor: AuthzActor,
    memberId: string,
    disciplineId: string,
  ): Promise<CurriculumCompletion[]> {
    if (!can(actor, { resource: 'curriculum', action: 'read', ownerMemberId: memberId }))
      throw new ForbiddenError('read', 'curriculum');
    return this.completions.listByMemberDiscipline(memberId, disciplineId);
  }
}
