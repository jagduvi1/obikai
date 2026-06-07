import type { AuditAppendInput } from '@obikai/db';
import type { ConsentRecord, ConsentRepository as ConsentStore } from '@obikai/gdpr';
import { beforeEach, describe, expect, it } from 'vitest';
import { type ConsentAuditPort, ConsentService } from './consent.service.js';

/** In-memory append-only consent store mirroring @obikai/db's ConsentRepository semantics. */
class FakeConsentStore implements ConsentStore {
  readonly rows: ConsentRecord[] = [];
  async record(consent: ConsentRecord): Promise<void> {
    this.rows.push(consent);
  }
  async listForSubject(_t: ConsentRecord['tenantId'], subjectId: ConsentRecord['subjectId']) {
    return this.rows.filter((r) => r.subjectId === subjectId);
  }
  async withdraw(
    _t: ConsentRecord['tenantId'],
    subjectId: ConsentRecord['subjectId'],
    purpose: string,
    at: Date,
  ): Promise<ConsentRecord | null> {
    const current = [...this.rows]
      .reverse()
      .find((r) => r.subjectId === subjectId && r.purpose === purpose);
    if (!current || current.status !== 'granted') return null;
    const withdrawn: ConsentRecord = { ...current, status: 'withdrawn', withdrawnAt: at };
    this.rows.push(withdrawn);
    return withdrawn;
  }
}

class FakeAudit implements ConsentAuditPort {
  readonly entries: AuditAppendInput[] = [];
  async append(input: AuditAppendInput): Promise<unknown> {
    this.entries.push(input);
    return input;
  }
}

const subject = { tenantId: 't1', subjectId: 'u-sub' };
const CLOCK = () => new Date('2026-06-06T12:00:00.000Z');

describe('ConsentService', () => {
  let store: FakeConsentStore;
  let audit: FakeAudit;
  let svc: ConsentService;
  beforeEach(() => {
    store = new FakeConsentStore();
    audit = new FakeAudit();
    svc = new ConsentService(store, audit, CLOCK);
  });

  it('grants consent (basis defaults to consent), records evidence, and audits it', async () => {
    await svc.grant(subject, {
      purpose: 'marketing-email',
      policyVersion: '2026-06-01',
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
      note: 'checkbox shown',
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      subjectId: 'u-sub',
      purpose: 'marketing-email',
      lawfulBasis: 'consent',
      status: 'granted',
      source: 'self-service',
    });
    expect(store.rows[0]?.evidence).toEqual({
      ip: '203.0.113.5',
      userAgent: 'Mozilla/5.0',
      note: 'checkbox shown',
    });
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      actorId: 'u-sub',
      actorType: 'user',
      action: 'consent.granted',
      targetType: 'consent',
      targetId: 'marketing-email',
      ip: '203.0.113.5',
    });
  });

  it('withdraws an active grant (audited) and reports success', async () => {
    await svc.grant(subject, { purpose: 'photos', policyVersion: '2026-06-01' });
    const ok = await svc.withdraw(subject, 'photos', '203.0.113.9');
    expect(ok).toBe(true);
    const list = await svc.list(subject);
    expect(list.map((r) => r.status)).toEqual(['granted', 'withdrawn']);
    expect(audit.entries.map((e) => e.action)).toEqual(['consent.granted', 'consent.withdrawn']);
  });

  it('withdrawing with no active grant is a no-op (false, not audited)', async () => {
    const ok = await svc.withdraw(subject, 'never-granted', '203.0.113.9');
    expect(ok).toBe(false);
    expect(audit.entries).toHaveLength(0);
  });

  it('lists only the calling subject’s consents', async () => {
    await svc.grant(subject, { purpose: 'a', policyVersion: 'v1' });
    await svc.grant({ tenantId: 't1', subjectId: 'other' }, { purpose: 'b', policyVersion: 'v1' });
    const mine = await svc.list(subject);
    expect(mine.map((r) => r.purpose)).toEqual(['a']);
  });
});
