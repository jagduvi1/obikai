import type { TenantId, UserId } from '@obikai/domain';
import type { ErasureModelResult, ErasureResult } from '@obikai/gdpr';
import { AttendanceModel } from './attendance.js';
import {
  EmailVerificationTokenModel,
  IdentityModel,
  MemberInviteTokenModel,
  MembershipModel,
  PasswordResetTokenModel,
  SessionModel,
  UserModel,
} from './auth.js';
import { EnrollmentModel } from './billing.js';
import { ConsentModel } from './consent.js';
import { GuardianshipModel } from './guardianship.js';
import { HouseholdModel } from './household.js';
import { MemberModel } from './member.js';
import { MessageLogModel } from './message-log.js';
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
 * its credentials + sessions deleted so it can never log in again, and the subject's consent records
 * (Art. 7 evidence) are hard-deleted.
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
  ['memberInviteToken', MemberInviteTokenModel as unknown as DeletableModel],
  // The subject's broadcast/message delivery history (memberId-keyed PII: subject lines, status).
  ['messageLog', MessageLogModel as unknown as DeletableModel],
];

/**
 * Count the subject's ACTIVE login-account memberships in OTHER tenants, via the raw driver collection
 * (the guarded model would force the current tenant). A cross-training student (ADR-0004: one
 * tenant-global identity, many per-tenant memberships) must NOT have their shared account/credentials
 * destroyed when a single dojo erases its membership — that would lock them out of the other dojos.
 */
async function countOtherTenantMemberships(
  userId: string,
  currentTenantId: string,
): Promise<number> {
  return MembershipModel.collection.countDocuments({
    userId: String(userId),
    tenantId: { $ne: String(currentTenantId) },
  });
}

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
  // A storage failure must NOT abort the run before the PII columns + member root are anonymized
  // (that would leave raw PII behind). The blob delete is idempotent and re-runnable, so swallow the
  // error here; the row is anonymized below regardless, and erasure can be safely re-invoked.
  let blobDeleteFailures = 0;
  for (const w of waivers as { documentStorageKey: string | null }[]) {
    if (!w.documentStorageKey) continue;
    try {
      await storageDelete(w.documentStorageKey);
    } catch {
      blobDeleteFailures += 1;
    }
  }
  const wr = await WaiverSignatureModel.updateMany(
    { memberId: mid },
    { $set: { signedByName: '[erased]', ip: null, documentStorageKey: null } },
  ).exec();
  perModel.push({
    model: 'waiverSignature',
    strategy: 'crypto_shred',
    affected: wr.modifiedCount ?? 0,
    // Blobs whose storage delete failed (pointer already nulled) — non-zero means a safe re-run is due.
    retained: blobDeleteFailures,
  });

  // Guardianship: drop the MINOR-side edges that reference the erased member (the subject's guardians).
  // The guardian-side edges (where the subject is the guardian) are account-keyed and removed in the
  // userId block below. Both are tenant-scoped, so this only touches the current tenant.
  const gm = await GuardianshipModel.deleteMany({ minorMemberId: mid }).exec();
  perModel.push({
    model: 'guardianship',
    strategy: 'hard_delete',
    affected: gm.deletedCount ?? 0,
    retained: 0,
  });

  // Household: a family/billing unit other members may still belong to — drop only the subject's payer
  // LINKAGE, never the shared household name (other members' data).
  const hh = await HouseholdModel.updateMany(
    { payerMemberId: mid },
    { $set: { payerMemberId: null } },
  ).exec();
  perModel.push({
    model: 'household',
    strategy: 'anonymize',
    affected: hh.modifiedCount ?? 0,
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

  // 5. Account-keyed data. Split into (a) TENANT-SCOPED records that are always erased for this tenant,
  //    and (b) the TENANT-GLOBAL shared identity, which is only destroyed when the subject has no
  //    membership in any OTHER tenant (a cross-training student keeps their shared login — ADR-0004).
  if (userId) {
    const uid = String(userId);

    // (a) Tenant-scoped, always erased for THIS tenant (runs under the caller's tenant context).
    // Consent (Art. 7 evidence) is the subject's own PII keyed by userId.
    const cons = await ConsentModel.deleteMany({ subjectId: uid }).exec();
    perModel.push({
      model: 'consent',
      strategy: 'hard_delete',
      affected: cons.deletedCount ?? 0,
      retained: 0,
    });
    // Guardian-side guardianship edges (the subject acting FOR others) in this tenant.
    const gge = await GuardianshipModel.deleteMany({ guardianUserId: uid }).exec();
    perModel.push({
      model: 'guardianship',
      strategy: 'hard_delete',
      affected: gge.deletedCount ?? 0,
      retained: 0,
    });
    // Household payer-USER linkage in this tenant (name retained for remaining members).
    const hhu = await HouseholdModel.updateMany(
      { payerUserId: uid },
      { $set: { payerUserId: null } },
    ).exec();
    perModel.push({
      model: 'household',
      strategy: 'anonymize',
      affected: hhu.modifiedCount ?? 0,
      retained: 0,
    });

    // (b) Tenant-global shared identity. Destroying it locks the account out of EVERY tenant, so guard
    // against the cross-training case (ADR-0004: one login, many per-tenant memberships).
    const otherMemberships = await countOtherTenantMemberships(uid, tenantId);
    if (otherMemberships === 0) {
      // No other dojo relies on this login — lock it FIRST (delete credentials + sessions so a partial
      // run can never leave a loginable account), then anonymize the email.
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
      const prt = await PasswordResetTokenModel.deleteMany({ userId: uid }).exec();
      perModel.push({
        model: 'password_reset_token',
        strategy: 'hard_delete',
        affected: prt.deletedCount ?? 0,
        retained: 0,
      });
      const evt = await EmailVerificationTokenModel.deleteMany({ userId: uid }).exec();
      perModel.push({
        model: 'email_verification_token',
        strategy: 'hard_delete',
        affected: evt.deletedCount ?? 0,
        retained: 0,
      });
      const placeholder = `erased+${uid}@erased.invalid`;
      await UserModel.updateOne(
        { _id: uid },
        { $set: { email: placeholder, emailLower: placeholder } },
      ).exec();
      perModel.push({ model: 'user', strategy: 'anonymize', affected: 1, retained: 0 });
    } else {
      // Cross-training student: another tenant is still the controller of this shared account, so leave
      // the User/Identity/Session intact. This tenant's footprint + membership are already erased above.
      perModel.push({ model: 'user', strategy: 'retain', affected: 0, retained: otherMemberships });
    }
  }

  return {
    tenantId: tenantId as TenantId,
    // The subject is the member; the gdpr type brands subjectId as UserId (opaque id either way).
    subjectId: mid as unknown as UserId,
    erasedAt: now,
    perModel,
  };
}
