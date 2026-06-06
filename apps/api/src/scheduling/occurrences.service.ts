import { type AuthzActor, can } from '@obikai/authz';
import { expandWeekly } from '@obikai/db';
import type { ClassOccurrence, ClassSchedule } from '@obikai/domain';
import { ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * OccurrencesService — listing, materialization and cancellation of concrete ClassOccurrences
 * (scope §4.3, ADR-0014). Materialization expands a schedule's RRULE over a rolling horizon using
 * the dependency-free weekly expander, then idempotently upserts the rows (so re-running never
 * duplicates and per-occurrence overrides survive, §7). Framework-free; RBAC resource 'class'.
 */

/** The persistence surface for occurrence reads/writes — satisfied by @obikai/db's repository. */
export interface OccurrencesStore {
  findById(id: string): Promise<ClassOccurrence | null>;
  list(opts?: {
    from?: string;
    to?: string;
    locationId?: string;
    scheduleId?: string;
  }): Promise<ClassOccurrence[]>;
  materialize(
    rows: Array<{
      scheduleId: string;
      programId: string;
      locationId: string;
      startsAt: string;
      endsAt: string;
      capacity: number;
    }>,
  ): Promise<number>;
  setStatus(id: string, status: 'scheduled' | 'cancelled'): Promise<ClassOccurrence | null>;
}

/** The schedule lookup OccurrencesService needs to expand a series — satisfied by SchedulesStore. */
export interface ScheduleLookup {
  findById(id: string): Promise<ClassSchedule | null>;
}

export interface MaterializeOptions {
  /** Horizon lower bound (inclusive), UTC ISO. Defaults to "now" at call time. */
  from?: string;
  /** Horizon upper bound (exclusive), UTC ISO. Required (the caller picks the rolling horizon). */
  to: string;
}

/** Derive the series anchor date (local `YYYY-MM-DD`) from the horizon start in the schedule's tz. */
function localDateString(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export class OccurrencesService {
  constructor(
    private readonly store: OccurrencesStore,
    private readonly schedules: ScheduleLookup,
  ) {}

  async list(
    actor: AuthzActor,
    opts: { from?: string; to?: string; locationId?: string; scheduleId?: string } = {},
  ): Promise<ClassOccurrence[]> {
    if (!can(actor, { resource: 'class', action: 'list' }))
      throw new ForbiddenError('list', 'class');
    return this.store.list(opts);
  }

  async get(actor: AuthzActor, id: string): Promise<ClassOccurrence> {
    if (!can(actor, { resource: 'class', action: 'read' }))
      throw new ForbiddenError('read', 'class');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('occurrence', id);
    return existing;
  }

  /**
   * Expand a schedule's RRULE over `[from, to)` and idempotently materialize the occurrences.
   * Mutating action → RBAC 'class' update. Returns the count of NEW occurrences created.
   */
  async materialize(
    actor: AuthzActor,
    scheduleId: string,
    opts: MaterializeOptions,
  ): Promise<{ created: number }> {
    if (!can(actor, { resource: 'class', action: 'update' }))
      throw new ForbiddenError('update', 'class');

    const schedule = await this.schedules.findById(scheduleId);
    if (!schedule) throw new NotFoundError('schedule', scheduleId);

    const from = opts.from ?? new Date().toISOString();
    const expanded = expandWeekly({
      rrule: schedule.rrule,
      startTime: schedule.startTime,
      durationMin: schedule.durationMin,
      timezone: schedule.timezone,
      // Anchor the series at the horizon start (local date) — COUNT/UNTIL still bound it absolutely.
      seriesStart: localDateString(from, schedule.timezone),
      from,
      to: opts.to,
    });

    const rows = expanded.map((o) => ({
      scheduleId: schedule.id,
      programId: schedule.programId,
      locationId: schedule.locationId,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      capacity: schedule.capacity,
    }));

    const created = await this.store.materialize(rows);
    return { created };
  }

  /** Cancel a single occurrence (a per-occurrence override, §7). Mutating → RBAC 'class' update. */
  async cancel(actor: AuthzActor, id: string): Promise<ClassOccurrence> {
    if (!can(actor, { resource: 'class', action: 'update' }))
      throw new ForbiddenError('update', 'class');
    const existing = await this.store.findById(id);
    if (!existing) throw new NotFoundError('occurrence', id);
    const updated = await this.store.setStatus(id, 'cancelled');
    if (!updated) throw new NotFoundError('occurrence', id);
    return updated;
  }
}
