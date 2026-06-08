import type { AuthzActor } from '@obikai/authz';
import type { AuditAppendInput, MessageLogCreateInput } from '@obikai/db';
import type { BroadcastCreateInput, Member, MemberSegment, MessageLog } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BroadcastSender,
  BroadcastService,
  type ConsentSource,
  ForbiddenError,
  MAX_RECIPIENTS,
  type MemberSource,
  TooManyRecipientsError,
} from './broadcast.service.js';

const member = (over: Partial<Record<keyof Member, unknown>> = {}): Member =>
  ({
    id: 'm1',
    tenantId: 't1',
    userId: 'u1',
    householdId: null,
    firstName: 'Aiko',
    lastName: 'Tanaka',
    email: 'aiko@x.io',
    phone: null,
    dateOfBirth: null,
    status: 'active',
    joinDate: null,
    emergencyContact: null,
    notes: null,
    tags: [],
    createdAt: '2026-06-06T00:00:00.000Z',
    updatedAt: '2026-06-06T00:00:00.000Z',
    ...over,
  }) as Member;

class FakeMembers implements MemberSource {
  constructor(private readonly members: Member[]) {}
  async list(opts: { status?: Member['status']; tag?: string } = {}): Promise<Member[]> {
    return this.members.filter(
      (m) => (!opts.status || m.status === opts.status) && (!opts.tag || m.tags.includes(opts.tag)),
    );
  }
  async listByTags(tags: string[]): Promise<Member[]> {
    return this.members.filter((m) => tags.some((t) => m.tags.includes(t)));
  }
}

/** Marketing consent granted for the given subjectIds; everyone else has none. */
class FakeConsent implements ConsentSource {
  constructor(private readonly granted: Set<string>) {}
  async currentStatus(subjectId: string): Promise<'granted' | 'withdrawn' | null> {
    return this.granted.has(subjectId) ? 'granted' : null;
  }
}

class FakeSender implements BroadcastSender {
  readonly sent: string[] = [];
  failFor: string | null = null;
  async sendBroadcast(to: { email: string }): Promise<{ providerMessageId: string }> {
    if (to.email === this.failFor) throw new Error('smtp down');
    this.sent.push(to.email);
    return { providerMessageId: `p-${to.email}` };
  }
}

class FakeLog {
  readonly rows: MessageLogCreateInput[] = [];
  async record(input: MessageLogCreateInput): Promise<void> {
    this.rows.push(input);
  }
  async listByBroadcast(): Promise<MessageLog[]> {
    return [];
  }
  async listByMember(): Promise<MessageLog[]> {
    return [];
  }
}

class FakeAudit {
  readonly entries: AuditAppendInput[] = [];
  async append(input: AuditAppendInput): Promise<void> {
    this.entries.push(input);
  }
}

const staff: AuthzActor = { userId: 'u-staff', roles: [{ role: 'staff', locationScope: 'ALL' }] };
const bareMember: AuthzActor = {
  userId: 'u9',
  memberId: 'm9',
  roles: [{ role: 'member', locationScope: 'ALL' }],
};

const input = (over: Partial<BroadcastCreateInput> = {}): BroadcastCreateInput => ({
  segment: { kind: 'all' } as MemberSegment,
  category: 'transactional',
  channel: 'email',
  subject: 'Open mat Saturday',
  body: 'Come train!',
  ...over,
});

function build(members: Member[], granted: string[] = []) {
  const sender = new FakeSender();
  const log = new FakeLog();
  const audit = new FakeAudit();
  const svc = new BroadcastService(
    new FakeMembers(members),
    new FakeConsent(new Set(granted)),
    sender,
    log,
    audit,
  );
  return { svc, sender, log, audit };
}

describe('BroadcastService.broadcast', () => {
  it('forbids a non-staff actor', async () => {
    const { svc } = build([member()]);
    await expect(svc.broadcast(bareMember, input())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('sends a transactional broadcast to everyone with an email, skipping those without', async () => {
    const members = [
      member({ id: 'm1', email: 'a@x.io' }),
      member({ id: 'm2', email: null }), // no contact
      member({ id: 'm3', email: 'c@x.io' }),
    ];
    const { svc, sender, log, audit } = build(members);
    const res = await svc.broadcast(staff, input(), { ip: '203.0.113.1' });

    expect(sender.sent.sort()).toEqual(['a@x.io', 'c@x.io']);
    expect(res).toMatchObject({
      total: 3,
      sent: 2,
      skippedNoContact: 1,
      failed: 0,
      skippedNoConsent: 0,
    });
    // One MessageLog row per recipient; the run is audited.
    expect(log.rows).toHaveLength(3);
    expect(audit.entries[0]).toMatchObject({ action: 'broadcast.send', targetType: 'broadcast' });
  });

  it('gates a MARKETING broadcast on marketing consent (no consent / no login → skipped)', async () => {
    const members = [
      member({ id: 'm1', userId: 'u1', email: 'a@x.io' }), // consented
      member({ id: 'm2', userId: 'u2', email: 'b@x.io' }), // not consented
      member({ id: 'm3', userId: null, email: 'c@x.io' }), // no login → no consent record
    ];
    const { svc, sender, log } = build(members, ['u1']);
    const res = await svc.broadcast(staff, input({ category: 'marketing' }));

    expect(sender.sent).toEqual(['a@x.io']);
    expect(res).toMatchObject({ sent: 1, skippedNoConsent: 2, skippedNoContact: 0 });
    expect(log.rows.filter((r) => r.status === 'skipped_no_consent')).toHaveLength(2);
  });

  it('records a provider failure as failed (does not abort the run)', async () => {
    const members = [member({ id: 'm1', email: 'a@x.io' }), member({ id: 'm2', email: 'b@x.io' })];
    const { svc, sender, log } = build(members);
    sender.failFor = 'a@x.io';
    const res = await svc.broadcast(staff, input());

    expect(res).toMatchObject({ sent: 1, failed: 1 });
    expect(log.rows.find((r) => r.status === 'failed')?.error).toContain('smtp down');
  });

  it('refuses a segment over the synchronous recipient cap (422 upstream)', async () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) =>
      member({ id: `m${i}`, email: `m${i}@x.io` }),
    );
    const { svc } = build(many);
    await expect(svc.broadcast(staff, input())).rejects.toBeInstanceOf(TooManyRecipientsError);
  });
});
