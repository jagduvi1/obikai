import { api } from '@obikai/api-client';
import type { Attendance, AttendanceCreateInput } from '@obikai/domain';

/**
 * Attendance API binding (ADR-0014). A check-in is the canonical record that a member attended —
 * separate from a class booking — and it carries the discipline so the rank engine can count
 * "classes since last promotion". Recorded by an instructor from the occurrence roster here.
 */
export function recordAttendance(input: AttendanceCreateInput): Promise<Attendance> {
  return api.post<Attendance>('/attendance', input);
}
