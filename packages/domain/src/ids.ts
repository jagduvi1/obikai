/**
 * Branded id types. These are plain strings at runtime but distinct at compile time, so a
 * `StepId` can never be passed where a `VersionId` is expected — important in the rank engine
 * where several string ids coexist (ADR-0005).
 */

// Phantom property (not a `unique symbol`) so the brand is nameable in downstream .d.ts emit —
// avoids TS4023 when an inferred type (e.g. a Zod schema) leaks a branded id across packages.
export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type LocationId = Brand<string, 'LocationId'>;
export type SessionId = Brand<string, 'SessionId'>;

// CRM / membership / billing ids (ADR-0011/0013)
export type MemberId = Brand<string, 'MemberId'>;
export type HouseholdId = Brand<string, 'HouseholdId'>;
export type PlanId = Brand<string, 'PlanId'>;
export type EnrollmentId = Brand<string, 'EnrollmentId'>;
export type InvoiceId = Brand<string, 'InvoiceId'>;
export type PaymentId = Brand<string, 'PaymentId'>;
export type VatRateId = Brand<string, 'VatRateId'>;

// Scheduling / attendance / waiver ids (ADR-0014)
export type ProgramId = Brand<string, 'ProgramId'>;
export type ClassScheduleId = Brand<string, 'ClassScheduleId'>;
export type ClassOccurrenceId = Brand<string, 'ClassOccurrenceId'>;
export type BookingId = Brand<string, 'BookingId'>;
export type AttendanceId = Brand<string, 'AttendanceId'>;
export type WaiverTemplateId = Brand<string, 'WaiverTemplateId'>;
export type WaiverSignatureId = Brand<string, 'WaiverSignatureId'>;

// Rank-engine ids (ADR-0005)
export type DisciplineId = Brand<string, 'DisciplineId'>;
export type SystemId = Brand<string, 'SystemId'>;
export type VersionId = Brand<string, 'VersionId'>;
export type StepId = Brand<string, 'StepId'>;
export type TrackId = Brand<string, 'TrackId'>;
export type CurriculumId = Brand<string, 'CurriculumId'>;

/** Cast a raw string into a branded id. Use at trust boundaries (DB/HTTP) after validation. */
export function brand<B extends Brand<string, string>>(value: string): B {
  return value as B;
}
