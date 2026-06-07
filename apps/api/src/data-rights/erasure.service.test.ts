import type { AuthzActor } from '@obikai/authz';
import type { AuditAppendInput } from '@obikai/db';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../members/members.service.js';
import {
  type ErasureAuditPort,
  ErasureService,
  type ErasureStoragePort,
  type MemberLookupPort,
} from './erasure.service.js';

/**
 * Guard-path tests for ErasureService. The happy path performs real cross-collection erasure and is
 * covered by the db `eraseMemberSubject` test; here we lock the authz + existence guards that must
 * reject BEFORE any irreversible work runs.
 */
class FakeMembers implements MemberLookupPort {
  constructor(private readonly members: Record<string, { id: string; userId: string | null }>) {}
  async findById(id: string) {
    return this.members[id] ?? null;
  }
}
class FakeStorage implements ErasureStoragePort {
  readonly deleted: string[] = [];
  async delete(key: string) {
    this.deleted.push(key);
  }
}
class FakeAudit implements ErasureAuditPort {
  readonly entries: AuditAppendInput[] = [];
  async append(i: AuditAppendInput) {
    this.entries.push(i);
    return i;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

describe('ErasureService (guards)', () => {
  let storage: FakeStorage;
  let audit: FakeAudit;
  let svc: ErasureService;
  beforeEach(() => {
    storage = new FakeStorage();
    audit = new FakeAudit();
    svc = new ErasureService(new FakeMembers({ m1: { id: 'm1', userId: 'u9' } }), storage, audit);
  });

  it('forbids a non-staff actor (no member:delete) before doing anything', async () => {
    await expect(svc.eraseMember(member, 't1', 'm1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(audit.entries).toHaveLength(0);
    expect(storage.deleted).toHaveLength(0);
  });

  it('404s a missing member before doing anything', async () => {
    await expect(svc.eraseMember(owner, 't1', 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(audit.entries).toHaveLength(0);
  });
});
