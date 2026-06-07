import type {
  Booking,
  BookingStatus,
  ClassOccurrence,
  ClassSchedule,
  ClassScheduleCreateInput,
  OccurrenceStatus,
  Program,
  ProgramCreateInput,
} from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard, tenantUniqueIndex } from './tenant-guard.js';

/**
 * Classes & scheduling persistence (ADR-0014, scope §4.3). Four tenant-guarded collections:
 * `Program` (a class definition) → `ClassSchedule` (a recurring RRULE) → `ClassOccurrence` (a
 * concrete dated instance, materialized from the rule) → `Booking` (a member's reservation onto one
 * occurrence, with a waitlist). The `tenantGuard` plugin scopes every query/write to the active
 * tenant; this layer only maps Mongoose docs ↔ the `@obikai/domain` shapes. A member books a given
 * occurrence at most once (`{tenantId, occurrenceId, memberId}` unique).
 */

// ───────────────────────────── Program ─────────────────────────────

export interface ProgramDoc extends TenantScoped {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  disciplineId: string | null;
  defaultLocationId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const programSchema = new Schema<ProgramDoc>(
  {
    name: { type: String, required: true },
    description: { type: String, default: null },
    disciplineId: { type: String, default: null },
    defaultLocationId: { type: String, default: null },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

programSchema.plugin(tenantGuard);
// Hot list query: programs by name within a tenant.
programSchema.index({ tenantId: 1, name: 1 });

export const ProgramModel: Model<ProgramDoc> =
  (mongoose.models.Program as Model<ProgramDoc> | undefined) ??
  mongoose.model<ProgramDoc>('Program', programSchema);

export function toProgram(doc: ProgramDoc): Program {
  return {
    id: doc._id.toString() as Program['id'],
    tenantId: doc.tenantId as Program['tenantId'],
    name: doc.name,
    description: doc.description,
    disciplineId: doc.disciplineId,
    defaultLocationId: (doc.defaultLocationId as Program['defaultLocationId']) ?? null,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** A partial program update — every field optional (the create input's mutable fields). */
export type ProgramUpdateInput = Partial<ProgramCreateInput>;

function programFields(input: ProgramCreateInput): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description ?? null,
    disciplineId: input.disciplineId ?? null,
    defaultLocationId: input.defaultLocationId ?? null,
    active: input.active,
  };
}

export class ProgramRepository {
  constructor(private readonly model: Model<ProgramDoc> = ProgramModel) {}

  async create(input: ProgramCreateInput): Promise<Program> {
    const created = await this.model.create(programFields(input));
    return toProgram(created.toObject() as unknown as ProgramDoc);
  }

  async findById(id: string): Promise<Program | null> {
    const doc = await this.model.findById(id).lean<ProgramDoc>().exec();
    return doc ? toProgram(doc) : null;
  }

  async list(opts: { active?: boolean } = {}): Promise<Program[]> {
    const filter = opts.active !== undefined ? { active: opts.active } : {};
    const docs = await this.model.find(filter).sort({ name: 1 }).lean<ProgramDoc[]>().exec();
    return docs.map(toProgram);
  }

  async update(id: string, patch: ProgramUpdateInput): Promise<Program | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { new: true })
      .lean<ProgramDoc>()
      .exec();
    return doc ? toProgram(doc) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: String(id) }).exec();
    return (res.deletedCount ?? 0) > 0;
  }
}

// ─────────────────────────── ClassSchedule ───────────────────────────

export interface ClassScheduleDoc extends TenantScoped {
  _id: Types.ObjectId;
  programId: string;
  locationId: string;
  instructorUserId: string | null;
  rrule: string;
  startTime: string;
  durationMin: number;
  capacity: number;
  timezone: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const classScheduleSchema = new Schema<ClassScheduleDoc>(
  {
    programId: { type: String, required: true },
    locationId: { type: String, required: true },
    instructorUserId: { type: String, default: null },
    rrule: { type: String, required: true },
    startTime: { type: String, required: true },
    durationMin: { type: Number, required: true },
    capacity: { type: Number, required: true },
    timezone: { type: String, required: true, default: 'Europe/Stockholm' },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
);

classScheduleSchema.plugin(tenantGuard);
// List schedules by program / by location within a tenant.
classScheduleSchema.index({ tenantId: 1, programId: 1 });
classScheduleSchema.index({ tenantId: 1, locationId: 1 });

export const ClassScheduleModel: Model<ClassScheduleDoc> =
  (mongoose.models.ClassSchedule as Model<ClassScheduleDoc> | undefined) ??
  mongoose.model<ClassScheduleDoc>('ClassSchedule', classScheduleSchema);

export function toClassSchedule(doc: ClassScheduleDoc): ClassSchedule {
  return {
    id: doc._id.toString() as ClassSchedule['id'],
    tenantId: doc.tenantId as ClassSchedule['tenantId'],
    programId: doc.programId as ClassSchedule['programId'],
    locationId: doc.locationId as ClassSchedule['locationId'],
    instructorUserId: doc.instructorUserId,
    rrule: doc.rrule,
    startTime: doc.startTime,
    durationMin: doc.durationMin,
    capacity: doc.capacity,
    timezone: doc.timezone,
    active: doc.active,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** A partial schedule update — every field optional (the create input's mutable fields). */
export type ClassScheduleUpdateInput = Partial<ClassScheduleCreateInput>;

function scheduleFields(input: ClassScheduleCreateInput): Record<string, unknown> {
  return {
    programId: input.programId,
    locationId: input.locationId,
    instructorUserId: input.instructorUserId ?? null,
    rrule: input.rrule,
    startTime: input.startTime,
    durationMin: input.durationMin,
    capacity: input.capacity,
    timezone: input.timezone,
    active: input.active,
  };
}

export class ClassScheduleRepository {
  constructor(private readonly model: Model<ClassScheduleDoc> = ClassScheduleModel) {}

  async create(input: ClassScheduleCreateInput): Promise<ClassSchedule> {
    const created = await this.model.create(scheduleFields(input));
    return toClassSchedule(created.toObject() as unknown as ClassScheduleDoc);
  }

  async findById(id: string): Promise<ClassSchedule | null> {
    const doc = await this.model.findById(id).lean<ClassScheduleDoc>().exec();
    return doc ? toClassSchedule(doc) : null;
  }

  async list(opts: { programId?: string; locationId?: string } = {}): Promise<ClassSchedule[]> {
    const filter: Record<string, unknown> = {};
    if (opts.programId !== undefined) filter.programId = String(opts.programId);
    if (opts.locationId !== undefined) filter.locationId = String(opts.locationId);
    const docs = await this.model
      .find(filter)
      .sort({ startTime: 1 })
      .lean<ClassScheduleDoc[]>()
      .exec();
    return docs.map(toClassSchedule);
  }

  async update(id: string, patch: ClassScheduleUpdateInput): Promise<ClassSchedule | null> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) out[key] = value;
    }
    const doc = await this.model
      .findByIdAndUpdate(id, out, { new: true })
      .lean<ClassScheduleDoc>()
      .exec();
    return doc ? toClassSchedule(doc) : null;
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.model.deleteOne({ _id: String(id) }).exec();
    return (res.deletedCount ?? 0) > 0;
  }
}

// ────────────────────────── ClassOccurrence ──────────────────────────

export interface ClassOccurrenceDoc extends TenantScoped {
  _id: Types.ObjectId;
  scheduleId: string;
  programId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  status: OccurrenceStatus;
  createdAt: Date;
  updatedAt: Date;
}

const classOccurrenceSchema = new Schema<ClassOccurrenceDoc>(
  {
    scheduleId: { type: String, required: true },
    programId: { type: String, required: true },
    locationId: { type: String, required: true },
    startsAt: { type: String, required: true },
    endsAt: { type: String, required: true },
    capacity: { type: Number, required: true },
    status: { type: String, required: true, default: 'scheduled' },
  },
  { timestamps: true },
);

classOccurrenceSchema.plugin(tenantGuard);
// Calendar query: occurrences in a date range (optionally by location, leads with startsAt).
classOccurrenceSchema.index({ tenantId: 1, startsAt: 1 });
// All occurrences materialized from a schedule (also used to de-dupe materialization).
classOccurrenceSchema.index({ tenantId: 1, scheduleId: 1 });
// Idempotent materialization: at most one occurrence per (schedule, instant).
classOccurrenceSchema.index(...tenantUniqueIndex({ scheduleId: 1, startsAt: 1 }));

export const ClassOccurrenceModel: Model<ClassOccurrenceDoc> =
  (mongoose.models.ClassOccurrence as Model<ClassOccurrenceDoc> | undefined) ??
  mongoose.model<ClassOccurrenceDoc>('ClassOccurrence', classOccurrenceSchema);

export function toClassOccurrence(doc: ClassOccurrenceDoc): ClassOccurrence {
  return {
    id: doc._id.toString() as ClassOccurrence['id'],
    tenantId: doc.tenantId as ClassOccurrence['tenantId'],
    scheduleId: doc.scheduleId as ClassOccurrence['scheduleId'],
    programId: doc.programId as ClassOccurrence['programId'],
    locationId: doc.locationId as ClassOccurrence['locationId'],
    startsAt: doc.startsAt,
    endsAt: doc.endsAt,
    capacity: doc.capacity,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** The materialized fields for one occurrence (the schedule supplies program/location/capacity). */
export interface OccurrenceMaterializeInput {
  scheduleId: string;
  programId: string;
  locationId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
}

export class ClassOccurrenceRepository {
  constructor(private readonly model: Model<ClassOccurrenceDoc> = ClassOccurrenceModel) {}

  async findById(id: string): Promise<ClassOccurrence | null> {
    const doc = await this.model.findById(id).lean<ClassOccurrenceDoc>().exec();
    return doc ? toClassOccurrence(doc) : null;
  }

  /** List occurrences in `[from, to)` (UTC ISO), optionally pinned to a location. Chronological. */
  async list(
    opts: { from?: string; to?: string; locationId?: string; scheduleId?: string } = {},
  ): Promise<ClassOccurrence[]> {
    const filter: Record<string, unknown> = {};
    if (opts.from !== undefined || opts.to !== undefined) {
      const range: Record<string, string> = {};
      if (opts.from !== undefined) range.$gte = opts.from;
      if (opts.to !== undefined) range.$lt = opts.to;
      filter.startsAt = range;
    }
    if (opts.locationId !== undefined) filter.locationId = String(opts.locationId);
    if (opts.scheduleId !== undefined) filter.scheduleId = String(opts.scheduleId);
    const docs = await this.model
      .find(filter)
      .sort({ startsAt: 1 })
      .lean<ClassOccurrenceDoc[]>()
      .exec();
    return docs.map(toClassOccurrence);
  }

  /**
   * Idempotently materialize occurrences. Each row is upserted on `{scheduleId, startsAt}` so
   * re-running over an overlapping horizon never duplicates an instance; returns the count of NEW
   * occurrences created.
   */
  async materialize(rows: OccurrenceMaterializeInput[]): Promise<number> {
    if (rows.length === 0) return 0;
    let created = 0;
    for (const row of rows) {
      // Upsert keyed by the unique (scheduleId, startsAt); $setOnInsert leaves existing rows (and
      // any per-occurrence overrides such as a cancelled status) untouched.
      const res = await this.model
        .updateOne(
          { scheduleId: String(row.scheduleId), startsAt: String(row.startsAt) },
          {
            $setOnInsert: {
              scheduleId: row.scheduleId,
              programId: row.programId,
              locationId: row.locationId,
              startsAt: row.startsAt,
              endsAt: row.endsAt,
              capacity: row.capacity,
              status: 'scheduled',
            },
          },
          { upsert: true },
        )
        .exec();
      if ((res.upsertedCount ?? 0) > 0) created++;
    }
    return created;
  }

  async setStatus(id: string, status: OccurrenceStatus): Promise<ClassOccurrence | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, { status }, { new: true })
      .lean<ClassOccurrenceDoc>()
      .exec();
    return doc ? toClassOccurrence(doc) : null;
  }
}

// ───────────────────────────── Booking ─────────────────────────────

export interface BookingDoc extends TenantScoped {
  _id: Types.ObjectId;
  occurrenceId: string;
  memberId: string;
  status: BookingStatus;
  bookedAt: string;
  createdAt: Date;
  updatedAt: Date;
}

const bookingSchema = new Schema<BookingDoc>(
  {
    occurrenceId: { type: String, required: true },
    memberId: { type: String, required: true },
    status: { type: String, required: true, default: 'booked' },
    bookedAt: { type: String, required: true },
  },
  { timestamps: true },
);

bookingSchema.plugin(tenantGuard);
// Roster + capacity/waitlist queries: all bookings for an occurrence.
bookingSchema.index({ tenantId: 1, occurrenceId: 1 });
// A member books a given occurrence at most once.
bookingSchema.index(...tenantUniqueIndex({ occurrenceId: 1, memberId: 1 }));

export const BookingModel: Model<BookingDoc> =
  (mongoose.models.Booking as Model<BookingDoc> | undefined) ??
  mongoose.model<BookingDoc>('Booking', bookingSchema);

export function toBooking(doc: BookingDoc): Booking {
  return {
    id: doc._id.toString() as Booking['id'],
    tenantId: doc.tenantId as Booking['tenantId'],
    occurrenceId: doc.occurrenceId as Booking['occurrenceId'],
    memberId: doc.memberId as Booking['memberId'],
    status: doc.status,
    bookedAt: doc.bookedAt,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** Raised when a member already has a booking for an occurrence — the {occurrence, member} guard. */
export class DuplicateBookingError extends Error {
  constructor(occurrenceId: string, memberId: string) {
    super(`member ${memberId} already has a booking for occurrence ${occurrenceId}`);
    this.name = 'DuplicateBookingError';
  }
}

export class BookingRepository {
  constructor(private readonly model: Model<BookingDoc> = BookingModel) {}

  async create(input: {
    occurrenceId: string;
    memberId: string;
    status: BookingStatus;
    bookedAt: string;
  }): Promise<Booking> {
    try {
      const created = await this.model.create({
        occurrenceId: input.occurrenceId,
        memberId: input.memberId,
        status: input.status,
        bookedAt: input.bookedAt,
      });
      return toBooking(created.toObject() as unknown as BookingDoc);
    } catch (err) {
      // The {tenantId, occurrenceId, memberId} unique index is the hard backstop against a
      // double-book that the service's soft pre-check can race past. Translate the raw Mongo 11000
      // into a typed, catchable signal so the controller returns 409 (not a 500) — matching the
      // DuplicateInvoicePeriodError / DuplicateVersionError convention elsewhere in this package.
      if ((err as { code?: number }).code === 11000) {
        throw new DuplicateBookingError(input.occurrenceId, input.memberId);
      }
      throw err;
    }
  }

  async findById(id: string): Promise<Booking | null> {
    const doc = await this.model.findById(id).lean<BookingDoc>().exec();
    return doc ? toBooking(doc) : null;
  }

  /** All bookings for an occurrence, oldest first (the waitlist promotion order). */
  async listByOccurrence(
    occurrenceId: string,
    opts: { status?: BookingStatus } = {},
  ): Promise<Booking[]> {
    const filter: Record<string, unknown> = { occurrenceId: String(occurrenceId) };
    if (opts.status !== undefined) filter.status = String(opts.status);
    const docs = await this.model.find(filter).sort({ bookedAt: 1 }).lean<BookingDoc[]>().exec();
    return docs.map(toBooking);
  }

  /** Count occurrence bookings in a given status (capacity check counts `booked`). */
  async countByOccurrence(occurrenceId: string, status: BookingStatus): Promise<number> {
    return this.model
      .countDocuments({ occurrenceId: String(occurrenceId), status: String(status) })
      .exec();
  }

  async setStatus(id: string, status: BookingStatus): Promise<Booking | null> {
    const doc = await this.model
      .findByIdAndUpdate(id, { status }, { new: true })
      .lean<BookingDoc>()
      .exec();
    return doc ? toBooking(doc) : null;
  }

  /**
   * Atomically promote ONE specific booking from 'waitlisted' to 'booked', but ONLY if it is still
   * waitlisted. Returns the promoted booking, or null if it was no longer waitlisted (a concurrent
   * cancel already claimed it). This compare-and-swap is what lets two concurrent cancels promote
   * two DISTINCT waitlisted bookings instead of both overwriting the same one — the same
   * claim-and-retry pattern used for rank-version minting (ADR-0023) and grant revocation (ADR-0012),
   * which `setStatus`' unconditional update cannot provide.
   */
  async promoteIfWaitlisted(id: string): Promise<Booking | null> {
    const doc = await this.model
      .findOneAndUpdate(
        { _id: String(id), status: 'waitlisted' },
        { $set: { status: 'booked' } },
        { new: true },
      )
      .lean<BookingDoc>()
      .exec();
    return doc ? toBooking(doc) : null;
  }
}
