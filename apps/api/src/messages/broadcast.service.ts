import { randomUUID } from 'node:crypto';
import { type AuthzActor, can } from '@obikai/authz';
import type { AuditAppendInput, MessageLogCreateInput } from '@obikai/db';
import type {
  BroadcastCreateInput,
  BroadcastResult,
  Member,
  MemberSegment,
  MessageLog,
  MessageStatus,
  UserId,
} from '@obikai/domain';
import { MARKETING_EMAIL_PURPOSE } from '@obikai/gdpr';

/**
 * BroadcastService — send an admin-authored message to a member segment (scope §4.8). It is
 * framework-free + composes narrow ports (members / consent / email / message-log / audit). The
 * consent split lives here: a `marketing` broadcast is gated per recipient on an active
 * `marketing_email` consent grant; a `transactional` one is not (operational info under
 * contract / legitimate interest). Every recipient attempt is logged (sent/failed/skipped) and the
 * whole run is audited.
 *
 * The send is SYNCHRONOUS + concurrency-bounded with a hard recipient cap — fan-out on the worker is
 * a deliberate follow-up (the API cannot currently enqueue jobs). The cap is surfaced (a 422), never a
 * silent truncation.
 */

export class ForbiddenError extends Error {
  constructor(action: string, resource: string) {
    super(`forbidden: ${action} on ${resource}`);
    this.name = 'ForbiddenError';
  }
}

export class TooManyRecipientsError extends Error {
  constructor(
    readonly count: number,
    readonly max: number,
  ) {
    super(`segment resolves to ${count} recipients, over the ${max} synchronous-broadcast limit`);
    this.name = 'TooManyRecipientsError';
  }
}

/** The synchronous-send guardrails (async worker fan-out is the follow-up). */
export const MAX_RECIPIENTS = 250;
const SEND_CONCURRENCY = 8;

// ── Narrow ports (satisfied by @obikai/db + @obikai/notifications) ───────────
export interface MemberSource {
  list(opts?: { status?: Member['status']; tag?: string }): Promise<Member[]>;
  listByTags(tags: string[], match?: 'any' | 'all'): Promise<Member[]>;
}
export interface ConsentSource {
  currentStatus(subjectId: string, purpose: string): Promise<'granted' | 'withdrawn' | null>;
}
export interface BroadcastSender {
  sendBroadcast(
    to: { email: string; name?: string },
    subject: string,
    body: string,
    tags?: Readonly<Record<string, string>>,
  ): Promise<{ providerMessageId: string }>;
}
export interface MessageLogStore {
  record(input: MessageLogCreateInput): Promise<unknown>;
  listByBroadcast(broadcastId: string): Promise<MessageLog[]>;
  listByMember(memberId: string): Promise<MessageLog[]>;
}
export interface BroadcastAuditPort {
  append(input: AuditAppendInput): Promise<unknown>;
}

/** Run `fn` over `items` with at most `limit` in flight (keeps a broadcast from a thundering send). */
async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
}

export class BroadcastService {
  constructor(
    private readonly members: MemberSource,
    private readonly consent: ConsentSource,
    private readonly sender: BroadcastSender,
    private readonly log: MessageLogStore,
    private readonly audit: BroadcastAuditPort,
  ) {}

  /** The delivery report for one broadcast (who was sent / skipped / failed). Staff-gated. */
  async deliveryReport(actor: AuthzActor, broadcastId: string): Promise<MessageLog[]> {
    if (!can(actor, { resource: 'announcement', action: 'read' }))
      throw new ForbiddenError('read', 'announcement');
    return this.log.listByBroadcast(broadcastId);
  }

  /** A member's message history (self-access for their own, staff via announcement:read). */
  async memberHistory(actor: AuthzActor, memberId: string): Promise<MessageLog[]> {
    const self = actor.memberId !== undefined && actor.memberId === memberId;
    if (!self && !can(actor, { resource: 'announcement', action: 'read' }))
      throw new ForbiddenError('read', 'announcement');
    return this.log.listByMember(memberId);
  }

  async broadcast(
    actor: AuthzActor,
    input: BroadcastCreateInput,
    meta: { ip?: string } = {},
  ): Promise<BroadcastResult> {
    if (!can(actor, { resource: 'announcement', action: 'create' }))
      throw new ForbiddenError('create', 'announcement');

    const recipients = await this.resolveSegment(input.segment);
    if (recipients.length > MAX_RECIPIENTS) {
      throw new TooManyRecipientsError(recipients.length, MAX_RECIPIENTS);
    }

    const broadcastId = randomUUID();
    const counts = { sent: 0, failed: 0, skippedNoContact: 0, skippedNoConsent: 0 };
    await mapWithConcurrency(recipients, SEND_CONCURRENCY, async (member) => {
      const status = await this.deliver(broadcastId, input, member);
      if (status === 'sent') counts.sent++;
      else if (status === 'failed') counts.failed++;
      else if (status === 'skipped_no_contact') counts.skippedNoContact++;
      else counts.skippedNoConsent++;
    });

    await this.audit.append({
      actorId: actor.userId as UserId,
      actorType: 'user',
      action: 'broadcast.send',
      targetType: 'broadcast',
      targetId: broadcastId,
      diff: {
        category: input.category,
        channel: input.channel,
        segment: JSON.stringify(input.segment),
        total: recipients.length,
        sent: counts.sent,
      },
      ...(meta.ip !== undefined ? { ip: meta.ip } : {}),
    });

    return { broadcastId, total: recipients.length, ...counts };
  }

  private resolveSegment(segment: MemberSegment): Promise<Member[]> {
    switch (segment.kind) {
      case 'all':
        return this.members.list();
      case 'status':
        return this.members.list({ status: segment.status });
      case 'tag':
        return this.members.listByTags([segment.tag], 'any');
    }
  }

  /** Deliver to one member, recording the outcome. Returns the per-recipient status. */
  private async deliver(
    broadcastId: string,
    input: BroadcastCreateInput,
    member: Member,
  ): Promise<MessageStatus> {
    if (!member.email) return this.record(broadcastId, input, member, 'skipped_no_contact');

    if (input.category === 'marketing') {
      // Marketing requires an active marketing_email consent. A member with no login (no userId) has
      // no consent record, so they cannot be sent marketing — skipped, not silently dropped.
      const granted =
        member.userId !== null &&
        (await this.consent.currentStatus(member.userId, MARKETING_EMAIL_PURPOSE)) === 'granted';
      if (!granted) return this.record(broadcastId, input, member, 'skipped_no_consent');
    }

    try {
      const { providerMessageId } = await this.sender.sendBroadcast(
        { email: member.email, name: `${member.firstName} ${member.lastName}` },
        input.subject,
        input.body,
        { kind: 'broadcast', category: input.category },
      );
      return this.record(broadcastId, input, member, 'sent', providerMessageId);
    } catch (err) {
      return this.record(
        broadcastId,
        input,
        member,
        'failed',
        null,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async record(
    broadcastId: string,
    input: BroadcastCreateInput,
    member: Member,
    status: MessageStatus,
    providerMessageId: string | null = null,
    error: string | null = null,
  ): Promise<MessageStatus> {
    await this.log.record({
      broadcastId,
      memberId: member.id,
      channel: input.channel,
      category: input.category,
      subject: input.subject,
      status,
      providerMessageId,
      error,
    });
    return status;
  }
}
