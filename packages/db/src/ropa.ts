import type {
  Attendance,
  Booking,
  CurriculumCompletion,
  Enrollment,
  GradingResultRecord,
  Invoice,
  Member,
  MemberRankState,
  PaymentAttempt,
  Promotion,
  WaiverSignature,
} from '@obikai/domain';
import { type ProcessingRecord, type Retention, RopaRegistry } from '@obikai/gdpr';
import { AttendanceModel, toAttendance } from './attendance.js';
import {
  EnrollmentModel,
  InvoiceModel,
  PaymentAttemptModel,
  toEnrollment,
  toInvoice,
  toPaymentAttempt,
} from './billing.js';
import { MemberModel, toMember } from './member.js';
import {
  CurriculumCompletionModel,
  GradingResultModel,
  MemberRankStateModel,
  PromotionModel,
  toCurriculumCompletion,
  toGradingResult,
  toMemberRankState,
  toPromotion,
} from './rank.js';
import { BookingModel, toBooking } from './scheduling.js';
import { WaiverSignatureModel, toWaiverSignature } from './waiver.js';

/**
 * The executable ROPA — Records of Processing Activities (GDPR Art. 30) that ALSO drives data export
 * (Art. 15/20) and right-to-erasure (Art. 17). `buildRopaRegistry()` registers one
 * {@link ProcessingRecord} per PII-bearing model; the export/erasure services walk the registry so a
 * new PII model is handled the moment it is registered (and a CI guard, added later, fails if a PII
 * model is NOT registered) — GDPR accountability as code, not a drifting document (ADR-0007/0026).
 *
 * SUBJECT MODEL: the data subject is a **Member** (`subjectId = memberId`). All records here are
 * tenant-scoped and member-keyed; `findBySubject` runs inside the caller's `runInTenantContext`, so the
 * `tenantGuard` scopes every query. The tenant-GLOBAL identity records (User / Identity / Session,
 * keyed by `userId`) are NOT in this registry — export/erasure handle them as an explicit step after
 * resolving the member's linked `userId` (see the export/erasure services).
 *
 * ERASURE MODEL (executed by the ErasureService, G6): erasure ANONYMIZES the Member root (strips its
 * PII), which de-identifies every member-keyed reference (they hold only `memberId`, an opaque key, not
 * direct PII). So most references can be `hard_delete`d (remove the footprint) or `retain`ed
 * (statutory/immutable, now de-identified). Records that DENORMALIZE PII (WaiverSignature stores
 * `signedByName`/`ip` + an encrypted document blob) additionally carry an `anonymize` transform and
 * `crypto_shred` their per-subject blob key.
 */

const YEAR_DAYS = 365;
const UNTIL_ERASURE: Retention = { kind: 'until_erasure' };
const BOOKKEEPING: Retention = {
  kind: 'period',
  days: 7 * YEAR_DAYS,
  legalBasis: 'Nordic bookkeeping law (~7y)',
};
const WAIVER_RETENTION: Retention = {
  kind: 'period',
  days: 10 * YEAR_DAYS,
  legalBasis: 'liability waiver — civil statute of limitations (~10y)',
};
const RANK_HISTORY: Retention = {
  kind: 'indefinite',
  justification:
    'immutable rank/grading history (invariant 5); de-identified on erasure via the anonymized member root',
};

/** Pick a subset of an object as a plain export record (PII the subject is entitled to). */
function pick<T extends object, K extends keyof T>(
  row: T,
  keys: readonly K[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k as string] = row[k];
  return out;
}

/** `findBySubject` for a member-keyed model: all rows whose `memberId` is the subject. */
function byMember<T>(
  model: {
    find: (filter: Record<string, unknown>) => { lean: () => { exec: () => Promise<unknown[]> } };
  },
  map: (doc: never) => T,
): (tenantId: string, subjectId: string) => Promise<readonly T[]> {
  return async (_tenantId, subjectId) => {
    const docs = await model
      .find({ memberId: String(subjectId) })
      .lean()
      .exec();
    return (docs as never[]).map(map);
  };
}

/**
 * Build and populate the ROPA registry. Called once at boot (api + worker). Pure assembly — every
 * query is deferred into the records' `findBySubject` closures and runs under the caller's tenant scope.
 */
export function buildRopaRegistry(): RopaRegistry {
  const registry = new RopaRegistry();

  const member: ProcessingRecord<Member> = {
    model: 'member',
    purpose: 'Membership administration and contact',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: UNTIL_ERASURE,
    erasure: 'anonymize',
    findBySubject: async (_t, subjectId) => {
      const doc = await MemberModel.findById(String(subjectId)).lean().exec();
      return doc ? [toMember(doc as never)] : [];
    },
    toExport: (m) =>
      pick(m, [
        'firstName',
        'lastName',
        'email',
        'phone',
        'dateOfBirth',
        'emergencyContact',
        'notes',
        'status',
        'joinDate',
        'createdAt',
      ]),
    anonymize: (m) => ({
      ...m,
      firstName: '[erased]',
      lastName: '[erased]',
      email: null,
      phone: null,
      dateOfBirth: null,
      emergencyContact: null,
      notes: null,
    }),
  };

  const attendance: ProcessingRecord<Attendance> = {
    model: 'attendance',
    purpose: 'Class attendance tracking and rank-eligibility computation',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: UNTIL_ERASURE,
    erasure: 'hard_delete',
    findBySubject: byMember<Attendance>(AttendanceModel as never, toAttendance as never),
    toExport: (a) =>
      pick(a, ['occurredAt', 'method', 'occurrenceId', 'programId', 'disciplineId', 'locationId']),
  };

  const booking: ProcessingRecord<Booking> = {
    model: 'booking',
    purpose: 'Class reservations and waitlist',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: UNTIL_ERASURE,
    erasure: 'hard_delete',
    findBySubject: byMember<Booking>(BookingModel as never, toBooking as never),
    toExport: (b) => pick(b, ['occurrenceId', 'status', 'bookedAt']),
  };

  const enrollment: ProcessingRecord<Enrollment> = {
    model: 'enrollment',
    purpose: 'Membership plan / subscription management',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: UNTIL_ERASURE,
    erasure: 'hard_delete',
    findBySubject: byMember<Enrollment>(EnrollmentModel as never, toEnrollment as never),
    toExport: (e) =>
      pick(e, [
        'planId',
        'status',
        'startDate',
        'currentPeriodStart',
        'currentPeriodEnd',
        'cancelAt',
      ]),
  };

  const invoice: ProcessingRecord<Invoice> = {
    model: 'invoice',
    purpose: 'Billing and statutory bookkeeping',
    lawfulBasis: 'legal_obligation',
    role: 'controller',
    retention: BOOKKEEPING,
    // Retained for bookkeeping; de-identified via the anonymized member root (never hard-deleted).
    erasure: 'retain',
    findBySubject: byMember<Invoice>(InvoiceModel as never, toInvoice as never),
    toExport: (i) =>
      pick(i, [
        'number',
        'status',
        'currency',
        'total',
        'lines',
        'issuedAt',
        'periodStart',
        'periodEnd',
      ]),
  };

  const paymentAttempt: ProcessingRecord<PaymentAttempt> = {
    model: 'paymentAttempt',
    purpose: 'Payment processing and reconciliation',
    lawfulBasis: 'legal_obligation',
    role: 'controller',
    retention: BOOKKEEPING,
    erasure: 'retain',
    findBySubject: async (_t, subjectId) => {
      // PaymentAttempt is keyed by invoiceId, not memberId — resolve via the member's invoices.
      const invs = await InvoiceModel.find({ memberId: String(subjectId) })
        .select('_id')
        .lean()
        .exec();
      const ids = (invs as { _id: { toString(): string } }[]).map((d) => d._id.toString());
      if (ids.length === 0) return [];
      const docs = await PaymentAttemptModel.find({ invoiceId: { $in: ids } })
        .lean()
        .exec();
      return (docs as never[]).map((d) => toPaymentAttempt(d as never));
    },
    toExport: (p) =>
      pick(p, ['invoiceId', 'provider', 'amount', 'status', 'attemptNo', 'createdAt']),
  };

  const rankState: ProcessingRecord<MemberRankState> = {
    model: 'memberRankState',
    purpose: 'Current rank position on the martial-arts journey',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: UNTIL_ERASURE,
    erasure: 'hard_delete',
    findBySubject: byMember<MemberRankState>(
      MemberRankStateModel as never,
      toMemberRankState as never,
    ),
    toExport: (s) =>
      pick(s, ['disciplineId', 'trackId', 'currentStepId', 'enteredCurrentStepAt', 'archived']),
  };

  const promotion: ProcessingRecord<Promotion> = {
    model: 'promotion',
    purpose: 'Immutable promotion history (invariant 5)',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: RANK_HISTORY,
    // Append-only history is never edited; de-identified on erasure via the anonymized member root.
    erasure: 'retain',
    findBySubject: byMember<Promotion>(PromotionModel as never, toPromotion as never),
    toExport: (p) =>
      pick(p, ['disciplineId', 'fromStepId', 'toStepId', 'awardedAt', 'awardedByRole']),
  };

  const gradingResult: ProcessingRecord<GradingResultRecord> = {
    model: 'gradingResult',
    purpose: 'Grading / examination outcomes',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: RANK_HISTORY,
    erasure: 'retain',
    findBySubject: byMember<GradingResultRecord>(
      GradingResultModel as never,
      toGradingResult as never,
    ),
    toExport: (g) => pick(g, ['gradingEventId', 'stepId', 'passed', 'recordedAt', 'notes']),
  };

  const curriculumCompletion: ProcessingRecord<CurriculumCompletion> = {
    model: 'curriculumCompletion',
    purpose: 'Curriculum progress tracking',
    lawfulBasis: 'contract',
    role: 'controller',
    retention: UNTIL_ERASURE,
    erasure: 'hard_delete',
    findBySubject: byMember<CurriculumCompletion>(
      CurriculumCompletionModel as never,
      toCurriculumCompletion as never,
    ),
    toExport: (c) => pick(c, ['disciplineId', 'itemKey', 'completedAt']),
  };

  const waiver: ProcessingRecord<WaiverSignature> = {
    model: 'waiverSignature',
    purpose: 'Liability waiver / consent to participate',
    lawfulBasis: 'legitimate_interests',
    role: 'controller',
    retention: WAIVER_RETENTION,
    // Crypto-shred the encrypted document blob (G6) AND anonymize the denormalized PII columns; the
    // legal FACT (member signed template vN at time T) is retained.
    erasure: 'crypto_shred',
    findBySubject: byMember<WaiverSignature>(
      WaiverSignatureModel as never,
      toWaiverSignature as never,
    ),
    toExport: (w) =>
      pick(w, ['templateId', 'templateVersion', 'signedByName', 'isGuardian', 'signedAt']),
    anonymize: (w) => ({ ...w, signedByName: '[erased]', ip: null }),
  };

  // Register each individually so each keeps its own `ProcessingRecord<T>` type (a heterogeneous
  // array would collapse the generic to a union and break the per-record `toExport`/`anonymize` types).
  registry.register(member);
  registry.register(attendance);
  registry.register(booking);
  registry.register(enrollment);
  registry.register(invoice);
  registry.register(paymentAttempt);
  registry.register(rankState);
  registry.register(promotion);
  registry.register(gradingResult);
  registry.register(curriculumCompletion);
  registry.register(waiver);
  return registry;
}

/** The model ids this registry covers — used by the CI guard that asserts every PII model is registered. */
export const ROPA_REGISTERED_MODELS = [
  'member',
  'attendance',
  'booking',
  'enrollment',
  'invoice',
  'paymentAttempt',
  'memberRankState',
  'promotion',
  'gradingResult',
  'curriculumCompletion',
  'waiverSignature',
] as const;
