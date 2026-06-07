import { type AuditAppendInput, buildExportBundle } from '@obikai/db';
import type { UserId } from '@obikai/domain';
import type { DataExportBundle, RopaRegistry } from '@obikai/gdpr';

/**
 * DataExportService — assembles a data-subject's export (GDPR Art. 15/20, audit H7) over the ROPA
 * registry and records the access on the tenant audit chain. Framework-free; the controller supplies
 * the authenticated subject. Self-service: the subject is always the caller.
 */

/** The audit surface — satisfied by @obikai/db's AuditLogRepository. */
export interface ExportAuditPort {
  append(input: AuditAppendInput): Promise<unknown>;
}

/** The authenticated data subject (derived from the request context). */
export interface ExportSubject {
  readonly tenantId: string;
  readonly userId: string;
  readonly memberId: string | null;
  readonly ip?: string;
}

export class DataExportService {
  constructor(
    private readonly registry: RopaRegistry,
    private readonly audit: ExportAuditPort,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Build the subject's full export bundle and audit the access (Art. 15(3) / 5(2)). */
  async export(subject: ExportSubject): Promise<DataExportBundle> {
    const bundle = await buildExportBundle(this.registry, {
      tenantId: subject.tenantId,
      memberId: subject.memberId,
      userId: subject.userId,
      now: this.now(),
    });
    await this.audit.append({
      actorId: subject.userId as UserId,
      actorType: 'user',
      action: 'data.export',
      targetType: 'dataSubject',
      targetId: subject.memberId ?? subject.userId,
      diff: { sections: bundle.sections.length },
      ...(subject.ip !== undefined ? { ip: subject.ip } : {}),
    });
    return bundle;
  }
}
