import { z } from 'zod';
import type {
  BookingId,
  ClassOccurrenceId,
  ClassScheduleId,
  LocationId,
  MemberId,
  ProgramId,
  TenantId,
} from './ids.js';

/**
 * Classes & scheduling (ADR-0014, scope §4.3). A Program is a class definition (e.g. "Adults BJJ");
 * a ClassSchedule is a recurring weekly rule (iCal RRULE) that generates concrete ClassOccurrences;
 * a Booking is a member's reservation against one occurrence (with waitlist). One-off
 * cancellations/overrides live on the occurrence, not the rule (§7).
 */

export interface Program {
  readonly id: ProgramId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly description: string | null;
  /** Optional link to a rank discipline (rank engine), or null for non-graded programs. */
  readonly disciplineId: string | null;
  readonly defaultLocationId: LocationId | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClassSchedule {
  readonly id: ClassScheduleId;
  readonly tenantId: TenantId;
  readonly programId: ProgramId;
  readonly locationId: LocationId;
  readonly instructorUserId: string | null;
  /** iCal RRULE, e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR`. */
  readonly rrule: string;
  /** Local start time `HH:mm` in the schedule timezone. */
  readonly startTime: string;
  readonly durationMin: number;
  readonly capacity: number;
  readonly timezone: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const OCCURRENCE_STATUSES = ['scheduled', 'cancelled'] as const;
export type OccurrenceStatus = (typeof OCCURRENCE_STATUSES)[number];

export interface ClassOccurrence {
  readonly id: ClassOccurrenceId;
  readonly tenantId: TenantId;
  readonly scheduleId: ClassScheduleId;
  readonly programId: ProgramId;
  readonly locationId: LocationId;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
  readonly status: OccurrenceStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const BOOKING_STATUSES = [
  'booked',
  'waitlisted',
  'cancelled',
  'attended',
  'no_show',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface Booking {
  readonly id: BookingId;
  readonly tenantId: TenantId;
  readonly occurrenceId: ClassOccurrenceId;
  readonly memberId: MemberId;
  readonly status: BookingStatus;
  readonly bookedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const programCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  disciplineId: z.string().min(1).nullable().optional(),
  defaultLocationId: z.string().min(1).nullable().optional(),
  active: z.boolean().default(true),
});
export type ProgramCreateInput = z.infer<typeof programCreateSchema>;

export const classScheduleCreateSchema = z.object({
  programId: z.string().min(1),
  locationId: z.string().min(1),
  instructorUserId: z.string().min(1).nullable().optional(),
  rrule: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().positive(),
  capacity: z.number().int().positive(),
  timezone: z.string().min(1).default('Europe/Stockholm'),
  active: z.boolean().default(true),
});
export type ClassScheduleCreateInput = z.infer<typeof classScheduleCreateSchema>;

export const bookingCreateSchema = z.object({
  occurrenceId: z.string().min(1),
  memberId: z.string().min(1),
});
export type BookingCreateInput = z.infer<typeof bookingCreateSchema>;
