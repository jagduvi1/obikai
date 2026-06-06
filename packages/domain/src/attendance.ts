import { z } from 'zod';
import type {
  AttendanceId,
  ClassOccurrenceId,
  LocationId,
  MemberId,
  ProgramId,
  TenantId,
} from './ids.js';

/**
 * Attendance & check-in (ADR-0014, scope §4.4). This is the bridge between scheduling and the rank
 * engine: attendance is stored with `disciplineId` + `occurredAt` so the app can answer "classes
 * since last promotion in discipline X" as a cheap indexed range count (the rank engine itself
 * stays pure — it receives that number, ADR-0005).
 */
export const CHECKIN_METHODS = ['kiosk_pin', 'kiosk_qr', 'instructor', 'self', 'import'] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

export interface Attendance {
  readonly id: AttendanceId;
  readonly tenantId: TenantId;
  readonly memberId: MemberId;
  readonly occurrenceId: ClassOccurrenceId | null;
  readonly programId: ProgramId | null;
  /** Rank discipline this class counts toward (drives promotion eligibility), or null. */
  readonly disciplineId: string | null;
  readonly locationId: LocationId | null;
  readonly occurredAt: string;
  readonly method: CheckinMethod;
  readonly createdAt: string;
}

export const attendanceCreateSchema = z.object({
  memberId: z.string().min(1),
  occurrenceId: z.string().min(1).nullable().optional(),
  programId: z.string().min(1).nullable().optional(),
  disciplineId: z.string().min(1).nullable().optional(),
  locationId: z.string().min(1).nullable().optional(),
  occurredAt: z.string().datetime().optional(),
  method: z.enum(CHECKIN_METHODS).default('instructor'),
});
export type AttendanceCreateInput = z.infer<typeof attendanceCreateSchema>;
