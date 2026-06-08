import type { Attendance, AttendanceCreateInput, CheckinMethod } from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Attendance & check-in persistence (ADR-0014, scope §4.4). Rows are IMMUTABLE: a check-in is an
 * event, so the repository only records, lists and counts — it never updates or deletes. The
 * `tenantGuard` plugin scopes every query/write to the active tenant (ADR-0004).
 *
 * `occurredAt` is stored as a real `Date` (not the ISO string the domain carries) so that
 * `classesSinceLastPromotion` is a cheap indexed range count — the bridge that feeds the pure rank
 * engine "classes since last promotion in discipline X" (ADR-0005). The `{tenantId, memberId,
 * disciplineId, occurredAt}` index serves exactly that query.
 */
export interface AttendanceDoc extends TenantScoped {
  _id: Types.ObjectId;
  memberId: string;
  occurrenceId: string | null;
  programId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  occurredAt: Date;
  method: CheckinMethod;
  createdAt: Date;
  updatedAt: Date;
}

const attendanceSchema = new Schema<AttendanceDoc>(
  {
    memberId: { type: String, required: true },
    occurrenceId: { type: String, default: null },
    programId: { type: String, default: null },
    disciplineId: { type: String, default: null },
    locationId: { type: String, default: null },
    occurredAt: { type: Date, required: true },
    method: { type: String, required: true, default: 'instructor' },
  },
  { timestamps: true },
);

attendanceSchema.plugin(tenantGuard);
// Drives `classesSinceLastPromotion` (member + discipline range count) and the member-history list.
attendanceSchema.index({ tenantId: 1, memberId: 1, disciplineId: 1, occurredAt: 1 });
// Per-occurrence attendance: roster "who attended" + the self-check-in idempotency lookup.
attendanceSchema.index({ tenantId: 1, occurrenceId: 1, memberId: 1 });

export const AttendanceModel: Model<AttendanceDoc> =
  (mongoose.models.Attendance as Model<AttendanceDoc> | undefined) ??
  mongoose.model<AttendanceDoc>('Attendance', attendanceSchema);

export function toAttendance(doc: AttendanceDoc): Attendance {
  return {
    id: doc._id.toString() as Attendance['id'],
    tenantId: doc.tenantId as Attendance['tenantId'],
    memberId: doc.memberId as Attendance['memberId'],
    occurrenceId: (doc.occurrenceId as Attendance['occurrenceId']) ?? null,
    programId: (doc.programId as Attendance['programId']) ?? null,
    disciplineId: doc.disciplineId ?? null,
    locationId: (doc.locationId as Attendance['locationId']) ?? null,
    occurredAt: doc.occurredAt.toISOString(),
    method: doc.method,
    createdAt: doc.createdAt.toISOString(),
  };
}

function fields(input: AttendanceCreateInput): Record<string, unknown> {
  return {
    memberId: input.memberId,
    occurrenceId: input.occurrenceId ?? null,
    programId: input.programId ?? null,
    disciplineId: input.disciplineId ?? null,
    locationId: input.locationId ?? null,
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    method: input.method,
  };
}

/** Filter for listing a member's attendance, optionally narrowed to a single discipline. */
export interface AttendanceFilter {
  memberId?: string;
  disciplineId?: string;
}

/**
 * Tenant-scoped Attendance repository. Every method runs through the guarded model, so it requires
 * an active TenantContext (ADR-0004) — calling it with no context throws rather than leaking. Rows
 * are immutable, so there is intentionally no update/remove.
 */
export class AttendanceRepository {
  constructor(private readonly model: Model<AttendanceDoc> = AttendanceModel) {}

  async record(input: AttendanceCreateInput): Promise<Attendance> {
    const created = await this.model.create(fields(input));
    return toAttendance(created.toObject() as unknown as AttendanceDoc);
  }

  async list(filter: AttendanceFilter = {}): Promise<Attendance[]> {
    const query: Record<string, unknown> = {};
    if (filter.memberId !== undefined) query.memberId = String(filter.memberId);
    if (filter.disciplineId !== undefined) query.disciplineId = String(filter.disciplineId);
    const docs = await this.model
      .find(query)
      .sort({ occurredAt: -1 })
      .lean<AttendanceDoc[]>()
      .exec();
    return docs.map(toAttendance);
  }

  /**
   * The member's existing check-in for an occurrence, if any — the idempotency guard for self
   * check-in (a member tapping "check in" twice must not record two rows). Indexed by
   * `{tenantId, occurrenceId, memberId}`.
   */
  async findByMemberOccurrence(memberId: string, occurrenceId: string): Promise<Attendance | null> {
    const doc = await this.model
      .findOne({ memberId: String(memberId), occurrenceId: String(occurrenceId) })
      .lean<AttendanceDoc>()
      .exec();
    return doc ? toAttendance(doc) : null;
  }

  /**
   * Count attendance rows for one member in one discipline strictly AFTER `since` — the number the
   * pure rank engine consumes as "classes since last promotion in discipline X" (ADR-0005). The
   * `{tenantId, memberId, disciplineId, occurredAt}` index makes this an indexed range count.
   */
  async classesSinceLastPromotion(
    memberId: string,
    disciplineId: string,
    since: Date,
  ): Promise<number> {
    return this.model
      .countDocuments({
        memberId: String(memberId),
        disciplineId: String(disciplineId),
        occurredAt: { $gt: since },
      })
      .exec();
  }
}
