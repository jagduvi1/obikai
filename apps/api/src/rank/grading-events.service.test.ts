import type { AuthzActor } from '@obikai/authz';
import type { GradingEvent, GradingEventStatus, GradingResultRecord } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  GradingEventsService,
  type GradingEventsStore,
  type GradingResultsStore,
  NotFoundError,
} from './grading-events.service.js';

class FakeEvents implements GradingEventsStore {
  readonly byId = new Map<string, GradingEvent>();
  private seq = 0;
  async create(input: {
    disciplineId: string;
    name: string;
    scheduledAt: string;
    locationId?: string | null;
  }): Promise<GradingEvent> {
    const id = `ge${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const ev: GradingEvent = {
      id: id as GradingEvent['id'],
      tenantId: 't1' as GradingEvent['tenantId'],
      disciplineId: input.disciplineId as GradingEvent['disciplineId'],
      name: input.name,
      scheduledAt: input.scheduledAt,
      locationId: input.locationId ?? null,
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, ev);
    return ev;
  }
  async findById(id: string): Promise<GradingEvent | null> {
    return this.byId.get(id) ?? null;
  }
  async list(opts: { disciplineId?: string } = {}): Promise<GradingEvent[]> {
    return [...this.byId.values()].filter((e) =>
      opts.disciplineId ? e.disciplineId === opts.disciplineId : true,
    );
  }
  async update(
    id: string,
    patch: {
      name?: string;
      scheduledAt?: string;
      locationId?: string | null;
      status?: GradingEventStatus;
    },
  ): Promise<GradingEvent | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as GradingEvent;
    this.byId.set(id, next);
    return next;
  }
}

class FakeResults implements GradingResultsStore {
  readonly rows: GradingResultRecord[] = [];
  async record(input: {
    gradingEventId: string;
    memberId: string;
    stepId: string;
    passed: boolean;
    recordedByUserId: string;
    recordedAt: string;
    notes?: string | null;
  }): Promise<GradingResultRecord> {
    const key = (r: { gradingEventId: string; memberId: string; stepId: string }) =>
      `${r.gradingEventId}|${r.memberId}|${r.stepId}`;
    const idx = this.rows.findIndex((r) => key(r) === key(input));
    const rec: GradingResultRecord = {
      id: `gr${this.rows.length + 1}`,
      tenantId: 't1' as GradingResultRecord['tenantId'],
      gradingEventId: input.gradingEventId as GradingResultRecord['gradingEventId'],
      memberId: input.memberId as GradingResultRecord['memberId'],
      stepId: input.stepId as GradingResultRecord['stepId'],
      passed: input.passed,
      recordedByUserId: input.recordedByUserId,
      recordedAt: input.recordedAt,
      notes: input.notes ?? null,
    };
    if (idx >= 0) this.rows[idx] = { ...rec, id: this.rows[idx]!.id };
    else this.rows.push(rec);
    return rec;
  }
  async listByEvent(gradingEventId: string): Promise<GradingResultRecord[]> {
    return this.rows.filter((r) => r.gradingEventId === gradingEventId);
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
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });
const CLOCK = () => new Date('2026-06-06T12:00:00.000Z');

const make = () => {
  const events = new FakeEvents();
  const results = new FakeResults();
  return { svc: new GradingEventsService(events, results, CLOCK), events, results };
};

describe('GradingEventsService', () => {
  it('instructor creates, lists, gets, and updates an event', async () => {
    const { svc } = make();
    const ev = await svc.create(instructor, {
      disciplineId: 'disc1',
      name: 'Spring grading',
      scheduledAt: '2026-06-01T10:00:00.000Z',
    });
    expect(ev.status).toBe('scheduled');
    expect((await svc.list(instructor, { disciplineId: 'disc1' })).map((e) => e.id)).toEqual([
      ev.id,
    ]);
    expect(await svc.get(instructor, ev.id)).toBeTruthy();
    const done = await svc.update(instructor, ev.id, { status: 'completed' });
    expect(done.status).toBe('completed');
  });

  it('records results idempotently (re-record corrects, stamps the recorder)', async () => {
    const { svc, results } = make();
    const ev = await svc.create(instructor, {
      disciplineId: 'disc1',
      name: 'Grading',
      scheduledAt: '2026-06-01T10:00:00.000Z',
    });
    await svc.recordResult(instructor, ev.id, { memberId: 'm1', stepId: 'blue', passed: false });
    await svc.recordResult(instructor, ev.id, { memberId: 'm1', stepId: 'blue', passed: true });
    const rows = await svc.listResults(instructor, ev.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.passed).toBe(true);
    expect(rows[0]?.recordedByUserId).toBe('inst1');
    expect(results.rows[0]?.recordedAt).toBe('2026-06-06T12:00:00.000Z');
  });

  it('recordResult throws NotFound for an unknown event', async () => {
    const { svc } = make();
    await expect(
      svc.recordResult(instructor, 'nope', { memberId: 'm1', stepId: 'blue', passed: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('denies a bare member', async () => {
    const { svc } = make();
    await expect(svc.list(member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      svc.create(member, { disciplineId: 'd', name: 'x', scheduledAt: '2026-06-01T10:00:00.000Z' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
