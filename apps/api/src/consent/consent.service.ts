import type { AuditAppendInput } from '@obikai/db';
import type { UserId } from '@obikai/domain';
import type { ConsentRecord, ConsentRepository as ConsentStore, LawfulBasis } from '@obikai/gdpr';

/**
 * ConsentService — self-service consent capture/withdrawal (GDPR Art. 6(1)(a)/7, audit H8). Framework-
 * free so it unit-tests against fakes. The SUBJECT is always the authenticated user (a member manages
 * their OWN consent); acting on another person's behalf (guardian / staff paper-import) is a separate,
 * authorized path not yet built. Every grant/withdrawal is also written to the tamper-evident per-tenant
 * audit log (ADR-0026) for Art. 7(1) accountability.
 *
 * Persistence is append-only (`@obikai/db` ConsentRepository): a withdrawal never erases the grant, so
 * the controller can always demonstrate that consent was given and when it was withdrawn.
 */

/** The audit surface — satisfied by @obikai/db's AuditLogRepository. */
export interface ConsentAuditPort {
  append(input: AuditAppendInput): Promise<unknown>;
}

/** Identifies the data subject + tenant for a consent operation (both derived from the request). */
export interface ConsentSubject {
  readonly tenantId: string;
  readonly subjectId: string;
}

/** A self-service grant request (the body of POST /me/consent + request-derived evidence). */
export interface ConsentGrantInput {
  readonly purpose: string;
  readonly policyVersion: string;
  /** Defaults to `consent` — the only basis a subject grants/withdraws. */
  readonly lawfulBasis?: LawfulBasis;
  readonly ip?: string;
  readonly userAgent?: string;
  readonly note?: string;
}

export class ConsentService {
  constructor(
    private readonly store: ConsentStore,
    private readonly audit: ConsentAuditPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Grant consent for a purpose (self-service). Appends a granted record + audits it. */
  async grant(subject: ConsentSubject, input: ConsentGrantInput): Promise<void> {
    const grantedAt = this.now();
    const record: ConsentRecord = {
      tenantId: subject.tenantId as ConsentRecord['tenantId'],
      subjectId: subject.subjectId as ConsentRecord['subjectId'],
      purpose: input.purpose,
      lawfulBasis: input.lawfulBasis ?? 'consent',
      status: 'granted',
      policyVersion: input.policyVersion,
      grantedAt,
      withdrawnAt: null,
      source: 'self-service',
      // Art. 7(1) evidence — PII-minimized: how/when, not a copy of the whole request.
      evidence: {
        ...(input.ip !== undefined ? { ip: input.ip } : {}),
        ...(input.userAgent !== undefined ? { userAgent: input.userAgent } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
      },
    };
    await this.store.record(record);
    await this.audit.append({
      actorId: subject.subjectId as UserId,
      actorType: 'user',
      action: 'consent.granted',
      targetType: 'consent',
      targetId: input.purpose,
      diff: { policyVersion: input.policyVersion, lawfulBasis: record.lawfulBasis },
      ...(input.ip !== undefined ? { ip: input.ip } : {}),
    });
  }

  /**
   * Withdraw consent for a purpose (self-service, idempotent toward "not granted"). Returns true if an
   * active grant was withdrawn (and audited), false if there was nothing to withdraw.
   */
  async withdraw(subject: ConsentSubject, purpose: string, ip?: string): Promise<boolean> {
    const withdrawn = await this.store.withdraw(
      subject.tenantId as ConsentRecord['tenantId'],
      subject.subjectId as UserId,
      purpose,
      this.now(),
    );
    if (!withdrawn) return false;
    await this.audit.append({
      actorId: subject.subjectId as UserId,
      actorType: 'user',
      action: 'consent.withdrawn',
      targetType: 'consent',
      targetId: purpose,
      ...(ip !== undefined ? { ip } : {}),
    });
    return true;
  }

  /** The subject's full consent history (current state per purpose = the latest record). */
  async list(subject: ConsentSubject): Promise<readonly ConsentRecord[]> {
    return this.store.listForSubject(
      subject.tenantId as ConsentRecord['tenantId'],
      subject.subjectId as UserId,
    );
  }
}
