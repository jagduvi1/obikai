/**
 * ROPA coverage guard (ADR-0007) — the executable check that GDPR export (Art. 15/20) and erasure
 * (Art. 17) can NEVER silently miss a persisted model. ADR-0007 promised "CI fails if a model with
 * PII-tagged fields is not registered"; this is that guard.
 *
 * It enumerates EVERY registered Mongoose model and asserts each is exactly one of:
 *   (a) a subject-PII model registered in the ROPA registry (member-keyed export/erasure), or
 *   (b) handled by the export/erasure ACCOUNT step (the tenant-global identity tier + tenant-scoped
 *       account-keyed data: consent, membership), or
 *   (c) explicitly classified as NON-subject-PII (tenant/reference/config data, the controller's own
 *       billing identity, or a retained accountability log).
 *
 * A NEW model that is none of these FAILS this test — forcing a deliberate decision (register it for
 * export/erasure, or classify it) instead of a silent omission. This is what should have caught
 * MessageLog/Guardianship/Household slipping through unregistered.
 *
 * Importing the package index registers every model on the shared mongoose instance; no DB connection
 * is needed (this only inspects the model registry + the ROPA registry assembly).
 */
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import '../src/index.js';
import { ROPA_REGISTERED_MODELS, buildRopaRegistry } from '../src/ropa.js';

/** ROPA model id → its Mongoose model name (the registry uses lowerCamel ids; mongoose is PascalCase). */
const ROPA_MODEL_TO_MONGOOSE: Record<string, string> = {
  member: 'Member',
  attendance: 'Attendance',
  booking: 'Booking',
  enrollment: 'Enrollment',
  invoice: 'Invoice',
  paymentAttempt: 'PaymentAttempt',
  memberRankState: 'MemberRankState',
  promotion: 'Promotion',
  gradingResult: 'GradingResult',
  curriculumCompletion: 'CurriculumCompletion',
  waiverSignature: 'WaiverSignature',
  messageLog: 'MessageLog',
  guardianship: 'Guardianship',
  household: 'Household',
};

/**
 * Subject PII reached by the export/erasure ACCOUNT step (export-service / erasure-service userId block)
 * rather than the member-keyed ROPA registry loop: the tenant-global identity tier, plus the
 * tenant-scoped account-keyed records (consent, membership).
 */
const ACCOUNT_TIER = new Set([
  'User',
  'Identity',
  'Session',
  'PasswordResetToken',
  'EmailVerificationToken',
  'MemberInviteToken',
  'Membership',
  'Consent',
]);

/**
 * Models that hold NO data-subject PII: the tenant registry + reference/config data, the controller's
 * OWN billing/legal identity, and retained accountability logs. Adding here is a deliberate decision —
 * the row carries no member personal data (or is an immutable accountability record that erasure
 * de-identifies via the anonymized member root / opaque actor ids, never deletes).
 */
const NON_SUBJECT_PII = new Set([
  'Tenant',
  'BillingProfile',
  'Location',
  'WaiverTemplate',
  'VatRate',
  'Plan',
  'InvoiceCounter',
  'Discipline',
  'ProgressionSystem',
  'ProgressionSystemVersion',
  'GradingEvent',
  'CurriculumItem',
  'Program',
  'ClassSchedule',
  'ClassOccurrence',
  'AuditLog',
  'PlatformAudit',
  'PlatformGrant',
]);

describe('ROPA coverage (GDPR export/erasure completeness)', () => {
  it('every ROPA-registered model maps to a real Mongoose model', () => {
    const registered = [...buildRopaRegistry().models()].sort();
    // The hand-maintained constant must match the actual registry (kept for the export/erasure docs).
    expect(registered).toEqual([...ROPA_REGISTERED_MODELS].sort());
    for (const id of registered) {
      const mongooseName = ROPA_MODEL_TO_MONGOOSE[id];
      expect(mongooseName, `ROPA model '${id}' has no Mongoose mapping in this guard`).toBeDefined();
      expect(
        mongoose.models[mongooseName as string],
        `ROPA-mapped model '${mongooseName}' is not registered on mongoose`,
      ).toBeDefined();
    }
  });

  it('every registered Mongoose model is covered by ROPA, the account step, or the non-PII allow-list', () => {
    const ropaMongooseNames = new Set(Object.values(ROPA_MODEL_TO_MONGOOSE));
    const names = Object.keys(mongoose.models).sort();
    expect(names.length).toBeGreaterThan(30); // sanity: the index really registered the models

    const unclassified = names.filter(
      (n) => !ropaMongooseNames.has(n) && !ACCOUNT_TIER.has(n) && !NON_SUBJECT_PII.has(n),
    );
    expect(
      unclassified,
      `unclassified model(s) — register in ROPA (export/erasure) or classify in the guard: ${unclassified.join(', ')}`,
    ).toEqual([]);
  });
});
