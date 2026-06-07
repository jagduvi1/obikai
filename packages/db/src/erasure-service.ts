import type { TenantId, UserId } from '@obikai/domain';
import type { ErasureModelResult, ErasureResult } from '@obikai/gdpr';
import { AttendanceModel } from './attendance.js';
import { IdentityModel, MembershipModel, SessionModel, UserModel } from './auth.js';
import { EnrollmentModel } from './billing.js';
import { MemberModel } from './member.js';
import {
  CurriculumCompletionModel,
  GradingResultModel,
  MemberRankStateModel,
  PromotionModel,
} from './rank.js';
import { BookingModel } from './scheduling.js';
import { WaiverSignatureModel } from './waiver.js';

/**
 * Right-to-erasure execution (GDPR Art. 17, audit H4/H6) — written EXPLICITLY per model rather than as
 * a generic registry loop: erasure is irreversible, and a clever loop hiding a Doc-vs-domain field bug
 * (e.g. forgetting `emailLower`) could silently fail to remove data. The ROPA registry (ropa.ts)
 * declares each model's strategy; this executes it, and a test asserts the two stay aligned.
 *
 * MODEL (per ADR-0026 / the G6 PR): erasure ANONYMIZES the Member root (strips its PII + releases the
 * unique-email index), which de-identifies every member-keyed reference — those rows hold only the
 * opaque `memberId`, not raw PII. Footprint records are hard-deleted; bookkeeping/immutable history is
 * retained (now de-identified) with any free-text PII scrubbed; waiver document blobs are deleted from
 * object storage and the denormalized columns anonymized. The tenant-global account is anonymized and
 * its credentials + sessions deleted so it can never log in again.
 *
 * Runs inside the caller's `runInTenantContext`, so guarded models are tenant-scoped; the tenant-global
 * identity collections (User/Identity/Session) are queried by the opaque, globally-unique `userId`.
 * `storageDelete` is injected by the app (its storage adapter) so this module stays storage-free.
 *
 * NOTE: blob DELETION erases live documents. Making already-written BACKUP copies unreadable
 * (envelope-encryption crypto-shred) is the follow-up (G6b); at pre-launch no backups exist yet.
 */
export interface EraseSubjectInput {
  readonly tenantId: string;
  readonly memberId: string;
  /** The member's linked login account, or null for a member with no account. */
  readonly userId: string | null;
  /** Delete an object blob from storage (injected app storage adapter). */
  readonly storageDelete: (key: string) => Promise<void>;
  /** Epoch ms (injected clock). */
  readonly now: number;
}

/** Minimal structural view of the one Mongoose op each footprint model needs (avoids a Model<X> union). */
interface DeletableModel {
  deleteMany(filter: Record<string, unknown>): { exec(): Promise<{ deletedCount?: number }> };
}

/** Footprint collections removed entirely on erasure (member-keyed; `memberId` is globally unique). */
const HARD_DELETE_MODELS: ReadonlyArray<readonly [string, DeletableModel]> = [
  ['booking', BookingModel as unknown as DeletableModel],
  ['attendance', AttendanceModel as unknown as DeletableModel],
  ['enrollment', EnrollmentModel as unknown as DeletableModel],
  ['memberRankState', MemberRankStateModel as unknown as DeletableModel],
  ['curriculumCompletion', CurriculumCompletionModel as unknown as DeletableModel],
  ['membership', MembershipModel as unknown as DeletableModel],
];

export async function eraseMemberSubject(input: EraseSubjectInput): Promise<ErasureResult> {
  const { tenantId, memberId, userId, storageDelete, now } = input;
  const mid = String(memberId);
  const perModel: ErasureModelResult[] = [];

  // 1. Hard-delete the member's footprint.
  for (const [model, Model] of HARD_DELETE_MODELS) {
    const res = await Model.deleteMany({ memberId: mid }).exec();
    perModel.push({ model, strategy: 'hard_delete', affected: res.deletedCount ?? 0, retained: 0 });
  }

  // 2. Retained for statutory / immutable-history reasons, de-identified via the anonymized member
  //    root — but scrub any FREE-TEXT field that could embed PII (instructor notes, override reasons).
  const gr = await GradingResultModel.updateMany(
    { memberId: mid },
    { $set: { notes: null } },
  ).exec();
  perModel.push({
    model: 'gradingResult',
    strategy: 'retain',
    affected: gr.modifiedCount ?? 0,
    retained: gr.matchedCount ?? 0,
  });
  const pr = await PromotionModel.updateMany(
    { memberId: mid },
    { $set: { overrideReason: null } },
  ).exec();
  perModel.push({
    model: 'promotion',
    strategy: 'retain',
    affected: pr.modifiedCount ?? 0,
    retained: pr.matchedCount ?? 0,
  });

  // 3. Waivers: delete the rendered document blob from storage, then anonymize the denormalized PII
  //    columns. The legal fact (this member signed template vN at time T) is retained, de-identified.
  const waivers = await WaiverSignatureModel.find({ memberId: mid })
    .select('documentStorageKey')
    .lean()
    .exec();
  for (const w of waivers as { documentStorageKey: string | null }[]) {
    if (w.documentStorageKey) await storageDelete(w.documentStorageKey);
  }
  const wr = await WaiverSignatureModel.updateMany(
    { memberId: mid },
    { $set: { signedByName: '[erased]', ip: null, documentStorageKey: null } },
  ).exec();
  perModel.push({
    model: 'waiverSignature',
    strategy: 'crypto_shred',
    affected: wr.modifiedCount ?? 0,
    retained: 0,
  });

  // 4. Anonymize the Member ROOT. Clearing emailLower releases the per-tenant unique-email index so the
  //    address is no longer linkable; every retained member-keyed reference is now de-identified.
  const mr = await MemberModel.updateOne(
    { _id: mid },
    {
      $set: {
        firstName: '[erased]',
        lastName: '[erased]',
        email: null,
        emailLower: null,
        phone: null,
        dateOfBirth: null,
        emergencyContact: null,
        notes: null,
      },
    },
  ).exec();
  perModel.push({
    model: 'member',
    strategy: 'anonymize',
    affected: mr.modifiedCount ?? 0,
    retained: 0,
  });

  // 5. Tenant-global identity: anonymize the account email (unique placeholder keeps the index valid)
  //    and hard-delete credentials + sessions so the account can never authenticate again.
  if (userId) {
    const uid = String(userId);
    const placeholder = `erased+${uid}@erased.invalid`;
    await UserModel.updateOne(
      { _id: uid },
      { $set: { email: placeholder, emailLower: placeholder } },
    ).exec();
    perModel.push({ model: 'user', strategy: 'anonymize', affected: 1, retained: 0 });
    const ir = await IdentityModel.deleteMany({ userId: uid }).exec();
    perModel.push({
      model: 'identity',
      strategy: 'hard_delete',
      affected: ir.deletedCount ?? 0,
      retained: 0,
    });
    const sr = await SessionModel.deleteMany({ userId: uid }).exec();
    perModel.push({
      model: 'session',
      strategy: 'hard_delete',
      affected: sr.deletedCount ?? 0,
      retained: 0,
    });
  }

  return {
    tenantId: tenantId as TenantId,
    // The subject is the member; the gdpr type brands subjectId as UserId (opaque id either way).
    subjectId: mid as unknown as UserId,
    erasedAt: now,
    perModel,
  };
}
