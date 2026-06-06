import { type AuthzActor, can } from '@obikai/authz';
import type {
  GradingEvent,
  GradingEventCreateInput,
  GradingEventStatus,
  GradingResultCreateInput,
  GradingResultRecord,
} from '@obikai/domain';

/**
 * GradingEventsService — scheduling tests and recording pass/fail results (ADR-0015). Results feed
 * the engine's `passedGradingEvent` criterion (consumed via PromotionsService). Gated on the
 * `gradingEvent` resource (instructor/owner). Framework-free; tenant scoping via TenantContext.
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

export interface GradingEventsStore {
  create(input: {
    disciplineId: string;
    name: string;
    scheduledAt: string;
    locationId?: string | null;
  }): Promise<GradingEvent>;
  findById(id: string): Promise<GradingEvent | null>;
  list(opts?: { disciplineId?: string }): Promise<GradingEvent[]>;
  update(
    id: string,
    patch: {
      name?: string;
      scheduledAt?: string;
      locationId?: string | null;
      status?: GradingEventStatus;
    },
  ): Promise<GradingEvent | null>;
}

export interface GradingResultsStore {
  record(input: {
    gradingEventId: string;
    memberId: string;
    stepId: string;
    passed: boolean;
    recordedByUserId: string;
    recordedAt: string;
    notes?: string | null;
  }): Promise<GradingResultRecord>;
  listByEvent(gradingEventId: string): Promise<GradingResultRecord[]>;
}

export interface GradingEventUpdateInput {
  name?: string;
  scheduledAt?: string;
  locationId?: string | null;
  status?: GradingEventStatus;
}

export class GradingEventsService {
  constructor(
    private readonly events: GradingEventsStore,
    private readonly results: GradingResultsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(actor: AuthzActor, input: GradingEventCreateInput): Promise<GradingEvent> {
    if (!can(actor, { resource: 'gradingEvent', action: 'create' }))
      throw new ForbiddenError('create', 'gradingEvent');
    return this.events.create({
      disciplineId: input.disciplineId,
      name: input.name,
      scheduledAt: input.scheduledAt,
      locationId: input.locationId ?? null,
    });
  }

  async list(actor: AuthzActor, opts: { disciplineId?: string } = {}): Promise<GradingEvent[]> {
    if (!can(actor, { resource: 'gradingEvent', action: 'list' }))
      throw new ForbiddenError('list', 'gradingEvent');
    return this.events.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<GradingEvent> {
    if (!can(actor, { resource: 'gradingEvent', action: 'read' }))
      throw new ForbiddenError('read', 'gradingEvent');
    const event = await this.events.findById(id);
    if (!event) throw new NotFoundError('gradingEvent', id);
    return event;
  }

  async update(
    actor: AuthzActor,
    id: string,
    patch: GradingEventUpdateInput,
  ): Promise<GradingEvent> {
    if (!can(actor, { resource: 'gradingEvent', action: 'update' }))
      throw new ForbiddenError('update', 'gradingEvent');
    const updated = await this.events.update(id, patch);
    if (!updated) throw new NotFoundError('gradingEvent', id);
    return updated;
  }

  /** Record (or correct) a member's pass/fail for a step at this event — idempotent per the index. */
  async recordResult(
    actor: AuthzActor,
    eventId: string,
    input: GradingResultCreateInput,
  ): Promise<GradingResultRecord> {
    if (!can(actor, { resource: 'gradingEvent', action: 'update' }))
      throw new ForbiddenError('update', 'gradingEvent');
    const event = await this.events.findById(eventId);
    if (!event) throw new NotFoundError('gradingEvent', eventId);
    return this.results.record({
      gradingEventId: eventId,
      memberId: input.memberId,
      stepId: input.stepId,
      passed: input.passed,
      recordedByUserId: actor.userId,
      recordedAt: this.now().toISOString(),
      notes: input.notes ?? null,
    });
  }

  async listResults(actor: AuthzActor, eventId: string): Promise<GradingResultRecord[]> {
    if (!can(actor, { resource: 'gradingEvent', action: 'read' }))
      throw new ForbiddenError('read', 'gradingEvent');
    return this.results.listByEvent(eventId);
  }
}
