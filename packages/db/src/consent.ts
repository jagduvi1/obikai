import type { TenantId, UserId } from '@obikai/domain';
import type {
  ConsentRecord,
  ConsentRepository as ConsentRepositoryPort,
  ConsentStatus,
  LawfulBasis,
} from '@obikai/gdpr';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import { tenantGuard } from './tenant-guard.js';

/**
 * Consent-record persistence (ADR-0007/0026, GDPR Art. 6(1)(a)/7). Implements the DB-free
 * `ConsentRepository` port from `@obikai/gdpr`. Tenant-scoped via `tenantGuard`.
 *
 * APPEND-ONLY (audit H8): a withdrawal NEVER overwrites the grant — it appends a new `withdrawn`
 * record that carries the original `grantedAt`/evidence plus `withdrawnAt`, so Art. 7(1)
 * demonstrability ("the controller must be able to show consent was given") survives a withdrawal.
 * The CURRENT state for a (subject, purpose) is the most-recently-inserted row; `listForSubject`
 * returns the full history. There is intentionally no update/delete of grant evidence.
 */
interface ConsentDoc {
  _id: Types.ObjectId;
  tenantId: string;
  subjectId: string;
  purpose: string;
  lawfulBasis: LawfulBasis;
  status: ConsentStatus;
  policyVersion: string;
  grantedAt: Date;
  withdrawnAt: Date | null;
  source: string;
  evidence?: { ip?: string; userAgent?: string; note?: string };
  /** Mongoose-managed insertion time — the ordering key for "current state per purpose". */
  createdAt: Date;
}

const evidenceSchema = new Schema(
  { ip: { type: String }, userAgent: { type: String }, note: { type: String } },
  { _id: false },
);

const schema = new Schema<ConsentDoc>(
  {
    subjectId: { type: String, required: true },
    purpose: { type: String, required: true },
    lawfulBasis: { type: String, required: true },
    status: { type: String, required: true },
    policyVersion: { type: String, required: true },
    grantedAt: { type: Date, required: true },
    withdrawnAt: { type: Date, default: null },
    source: { type: String, required: true },
    evidence: { type: evidenceSchema },
  },
  // Only createdAt — a consent row is never updated (append-only), so updatedAt would be meaningless.
  { timestamps: { createdAt: true, updatedAt: false } },
);
schema.plugin(tenantGuard);
// Every read is "this subject's consents" / "this subject's consent for purpose X".
schema.index({ tenantId: 1, subjectId: 1, createdAt: 1 });
schema.index({ tenantId: 1, subjectId: 1, purpose: 1, createdAt: -1 });

export const ConsentModel: Model<ConsentDoc> =
  (mongoose.models.Consent as Model<ConsentDoc> | undefined) ??
  mongoose.model<ConsentDoc>('Consent', schema);

function toRecord(doc: ConsentDoc): ConsentRecord {
  return {
    tenantId: doc.tenantId as TenantId,
    subjectId: doc.subjectId as UserId,
    purpose: doc.purpose,
    lawfulBasis: doc.lawfulBasis,
    status: doc.status,
    policyVersion: doc.policyVersion,
    grantedAt: doc.grantedAt,
    withdrawnAt: doc.withdrawnAt,
    source: doc.source,
    ...(doc.evidence
      ? {
          evidence: {
            ...(doc.evidence.ip !== undefined ? { ip: doc.evidence.ip } : {}),
            ...(doc.evidence.userAgent !== undefined ? { userAgent: doc.evidence.userAgent } : {}),
            ...(doc.evidence.note !== undefined ? { note: doc.evidence.note } : {}),
          },
        }
      : {}),
  };
}

export class ConsentRepository implements ConsentRepositoryPort {
  constructor(private readonly model: Model<ConsentDoc> = ConsentModel) {}

  /** Append a consent record (a grant). Tenant is stamped from context by the guard. */
  async record(consent: ConsentRecord): Promise<void> {
    await this.model.create({
      subjectId: String(consent.subjectId),
      purpose: consent.purpose,
      lawfulBasis: consent.lawfulBasis,
      status: consent.status,
      policyVersion: consent.policyVersion,
      grantedAt: consent.grantedAt,
      withdrawnAt: consent.withdrawnAt,
      source: consent.source,
      ...(consent.evidence ? { evidence: consent.evidence } : {}),
    });
  }

  /** Full consent history for a subject, oldest → newest. Current state per purpose = the last row. */
  async listForSubject(_tenantId: TenantId, subjectId: UserId): Promise<readonly ConsentRecord[]> {
    const docs = await this.model
      .find({ subjectId: String(subjectId) })
      .sort({ createdAt: 1 })
      .lean<ConsentDoc[]>()
      .exec();
    return docs.map(toRecord);
  }

  /**
   * The subject's CURRENT status for a purpose — the most-recently-inserted record's `status`, or
   * null if none. Served by the `{tenantId, subjectId, purpose, createdAt:-1}` index.
   */
  async currentStatus(
    _tenantId: TenantId,
    subjectId: UserId,
    purpose: string,
  ): Promise<ConsentStatus | null> {
    const doc = await this.model
      .findOne({ subjectId: String(subjectId), purpose })
      .sort({ createdAt: -1 })
      .lean<ConsentDoc>()
      .exec();
    return doc ? doc.status : null;
  }

  /**
   * Withdraw consent for a purpose: if the subject's CURRENT record for that purpose is `granted`,
   * append a `withdrawn` record (carrying the original grant's evidence + `withdrawnAt = at`) and
   * return it. Returns null if there is no active grant to withdraw (already withdrawn / never
   * granted). The grant record is left untouched (append-only).
   */
  async withdraw(
    _tenantId: TenantId,
    subjectId: UserId,
    purpose: string,
    at: Date,
  ): Promise<ConsentRecord | null> {
    const current = await this.model
      .findOne({ subjectId: String(subjectId), purpose })
      .sort({ createdAt: -1 })
      .lean<ConsentDoc>()
      .exec();
    if (!current || current.status !== 'granted') return null;
    const created = await this.model.create({
      subjectId: current.subjectId,
      purpose: current.purpose,
      lawfulBasis: current.lawfulBasis,
      status: 'withdrawn' as ConsentStatus,
      policyVersion: current.policyVersion,
      grantedAt: current.grantedAt,
      withdrawnAt: at,
      source: current.source,
      ...(current.evidence ? { evidence: current.evidence } : {}),
    });
    return toRecord(created.toObject() as unknown as ConsentDoc);
  }
}
