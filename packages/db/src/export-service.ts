import type { TenantId } from '@obikai/domain';
import {
  type DataExportBundle,
  type DataExportSection,
  EXPORT_SCHEMA_VERSION,
  type RopaRegistry,
} from '@obikai/gdpr';
import { SessionModel, UserModel } from './auth.js';

/**
 * Data-subject export (GDPR Art. 15/20, audit H7). Walks the ROPA registry — for every exportable
 * member-keyed model it collects the subject's rows and maps them through the record's `toExport` —
 * then appends the tenant-GLOBAL identity (login account + sessions) resolved via the linked `userId`.
 * Runs inside the caller's `runInTenantContext`, so the member-keyed queries are tenant-scoped by the
 * guard; the identity collections are tenant-global by design (ADR-0012) and queried by `userId`.
 *
 * Pure assembly over injected persistence — no auth/HTTP here; the app wraps it with authz + audit.
 */
export interface ExportSubjectInput {
  readonly tenantId: string;
  /** The data subject's member id (member-keyed PII). Null for an account with no member profile. */
  readonly memberId: string | null;
  /** The subject's login account id (tenant-global identity). */
  readonly userId: string;
  /** Epoch ms (injected clock) stamped on the bundle. */
  readonly now: number;
}

export async function buildExportBundle(
  registry: RopaRegistry,
  input: ExportSubjectInput,
): Promise<DataExportBundle> {
  const { tenantId, memberId, userId, now } = input;
  const sections: DataExportSection[] = [];

  // 1. Member-keyed PII, driven by the ROPA registry (skip records without a `toExport`).
  if (memberId) {
    for (const record of registry.list()) {
      const { model, purpose, toExport, findBySubject } = record;
      if (!toExport) continue;
      // findBySubject's tenantId param is branded; our byMember impls ignore it (the guard scopes).
      const rows = await findBySubject(tenantId as TenantId, memberId);
      if (rows.length === 0) continue;
      sections.push({ model, purpose, records: rows.map((row) => toExport(row)) });
    }
  }

  // 2. Tenant-global identity (Art. 15(1)) — the login account + sessions, by userId. Secrets
  // (password/refresh-token hashes) are intentionally NOT exported.
  const user = await UserModel.findById(String(userId)).lean().exec();
  if (user) {
    sections.push({
      model: 'user',
      purpose: 'Login account',
      records: [
        {
          email: user.email,
          emailVerified: user.emailVerified,
          status: user.status,
          createdAt: user.createdAt.toISOString(),
        },
      ],
    });
  }
  const sessions = await SessionModel.find({ userId: String(userId) })
    .lean()
    .exec();
  if (sessions.length > 0) {
    sections.push({
      model: 'session',
      purpose: 'Login sessions',
      records: sessions.map((s) => ({
        ip: s.ip,
        userAgent: s.userAgent,
        lastUsedAt: s.lastUsedAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      })),
    });
  }

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    tenantId: tenantId as DataExportBundle['tenantId'],
    // The subject is the member where one exists, else the account.
    subjectId: (memberId ?? userId) as DataExportBundle['subjectId'],
    generatedAt: now,
    sections,
  };
}
