import { type AuthzActor, can } from '@obikai/authz';
import { type AuditAppendInput, eraseMemberSubject } from '@obikai/db';
import type { UserId } from '@obikai/domain';
import type { ErasureResult } from '@obikai/gdpr';
import { ForbiddenError, NotFoundError } from '../members/members.service.js';

/**
 * ErasureService — executes a data subject's right to erasure (GDPR Art. 17, audit H4). The dojo
 * (staff with `member:delete`) processes an erasure request for a member; the heavy lifting
 * (anonymize the member root, hard-delete the footprint, delete waiver blobs, scrub retained free-text,
 * erase the linked account) is the audited `eraseMemberSubject` in @obikai/db. This layer adds authz,
 * resolves the member's linked account, deletes blobs via the storage adapter, and records the
 * irreversible action on the tamper-evident tenant audit chain.
 */

/** The audit surface — satisfied by @obikai/db's AuditLogRepository. */
export interface ErasureAuditPort {
  append(input: AuditAppendInput): Promise<unknown>;
}

/** Minimal member lookup — satisfied by @obikai/db's MemberRepository (resolve existence + account). */
export interface MemberLookupPort {
  findById(id: string): Promise<{ id: string; userId: string | null } | null>;
}

/** Object-storage delete — satisfied by the configured StoragePort. */
export interface ErasureStoragePort {
  delete(key: string): Promise<void>;
}

export class ErasureService {
  constructor(
    private readonly members: MemberLookupPort,
    private readonly storage: ErasureStoragePort,
    private readonly audit: ErasureAuditPort,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Erase a member's personal data. Staff-only (`member:delete`); irreversible; audited. */
  async eraseMember(
    actor: AuthzActor,
    tenantId: string,
    memberId: string,
    ip?: string,
  ): Promise<ErasureResult> {
    if (!can(actor, { resource: 'member', action: 'delete' }))
      throw new ForbiddenError('delete', 'member');
    const member = await this.members.findById(memberId);
    if (!member) throw new NotFoundError('member', memberId);

    const result = await eraseMemberSubject({
      tenantId,
      memberId,
      userId: member.userId,
      storageDelete: (key) => this.storage.delete(key),
      now: this.now(),
    });

    await this.audit.append({
      actorId: actor.userId as UserId,
      actorType: 'user',
      action: 'data.erasure',
      targetType: 'dataSubject',
      targetId: memberId,
      // PII-minimized: how many model groups were processed, not the erased values.
      diff: { models: result.perModel.length },
      ...(ip !== undefined ? { ip } : {}),
    });
    return result;
  }
}
