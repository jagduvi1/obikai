import type {
  Membership,
  MembershipStatus,
  RoleAssignment,
  User,
  UserStatus,
} from '@obikai/domain';
import mongoose, { type Model, Schema, type Types } from 'mongoose';
import type { TenantScoped } from './repository.js';
import { tenantGuard } from './tenant-guard.js';

/**
 * Auth persistence (ADR-0012). `User`/`Identity`/`Session` are TENANT-GLOBAL and therefore
 * intentionally do NOT use `tenantGuard` (ADR-0004); `Membership` IS tenant-scoped (guarded). The
 * deliberate exemption is asserted negatively in test/auth.test.ts (global schemas have no tenantId
 * path; Membership does). The db exposes plain repositories returning domain shapes (+ a raw
 * credential record for the auth adapter's IdentityStore, wired in the app).
 */

// ── User (tenant-global) ──────────────────────────────────────────────────────
export interface UserDoc {
  _id: Types.ObjectId;
  email: string;
  emailLower: string;
  emailVerified: boolean;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true },
    emailLower: { type: String, required: true, unique: true },
    emailVerified: { type: Boolean, default: false },
    status: { type: String, required: true, default: 'active' },
  },
  { timestamps: true },
);

export const UserModel: Model<UserDoc> =
  (mongoose.models.User as Model<UserDoc> | undefined) ??
  mongoose.model<UserDoc>('User', userSchema);

export function toUser(doc: UserDoc): User {
  return {
    id: doc._id.toString() as User['id'],
    email: doc.email,
    emailVerified: doc.emailVerified,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class UserRepository {
  constructor(private readonly model: Model<UserDoc> = UserModel) {}

  async create(input: { email: string; emailVerified?: boolean }): Promise<User> {
    const created = await this.model.create({
      email: input.email,
      emailLower: input.email.trim().toLowerCase(),
      emailVerified: input.emailVerified ?? false,
    });
    return toUser(created.toObject() as unknown as UserDoc);
  }

  async findById(id: string): Promise<User | null> {
    const doc = await this.model.findById(id).lean<UserDoc>().exec();
    return doc ? toUser(doc) : null;
  }

  /** Hard-delete a user (compensating rollback for a failed identity create; GDPR erasure). */
  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: String(id) }).exec();
  }
}

// ── Identity (tenant-global local credential) ─────────────────────────────────
export interface IdentityDoc {
  _id: Types.ObjectId;
  userId: string;
  provider: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const identitySchema = new Schema<IdentityDoc>(
  {
    userId: { type: String, required: true, index: true },
    provider: { type: String, required: true, default: 'local' },
    email: { type: String, required: true },
    emailLower: { type: String, required: true },
    passwordHash: { type: String, required: true },
    emailVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);
identitySchema.index({ provider: 1, emailLower: 1 }, { unique: true });

export const IdentityModel: Model<IdentityDoc> =
  (mongoose.models.Identity as Model<IdentityDoc> | undefined) ??
  mongoose.model<IdentityDoc>('Identity', identitySchema);

/** Raw credential record (carries the password hash) — for the auth adapter's IdentityStore. */
export interface IdentityRecord {
  userId: string;
  email: string;
  emailLower: string;
  passwordHash: string;
  emailVerified: boolean;
}

export class IdentityRepository {
  constructor(private readonly model: Model<IdentityDoc> = IdentityModel) {}

  async findByEmailLower(provider: string, emailLower: string): Promise<IdentityRecord | null> {
    const doc = await this.model
      .findOne({ provider: String(provider), emailLower: String(emailLower) })
      .lean<IdentityDoc>()
      .exec();
    return doc
      ? {
          userId: doc.userId,
          email: doc.email,
          emailLower: doc.emailLower,
          passwordHash: doc.passwordHash,
          emailVerified: doc.emailVerified,
        }
      : null;
  }

  async create(rec: {
    userId: string;
    provider: string;
    email: string;
    passwordHash: string;
    emailVerified: boolean;
  }): Promise<void> {
    await this.model.create({ ...rec, emailLower: rec.email.trim().toLowerCase() });
  }

  /** Hard-delete all local credentials for a user (GDPR erasure, ADR-0007). */
  async deleteByUserId(userId: string): Promise<void> {
    await this.model.deleteMany({ userId: String(userId) }).exec();
  }
}

// ── Session (tenant-global; rotating refresh) ─────────────────────────────────
export interface SessionDoc {
  _id: Types.ObjectId;
  userId: string;
  family: string;
  refreshTokenHash: string;
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    userId: { type: String, required: true, index: true },
    family: { type: String, required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true },
);

export const SessionModel: Model<SessionDoc> =
  (mongoose.models.Session as Model<SessionDoc> | undefined) ??
  mongoose.model<SessionDoc>('Session', sessionSchema);

export interface SessionRecord {
  id: string;
  userId: string;
  family: string;
  refreshTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

function toSessionRecord(doc: SessionDoc): SessionRecord {
  return {
    id: doc._id.toString(),
    userId: doc.userId,
    family: doc.family,
    refreshTokenHash: doc.refreshTokenHash,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt,
  };
}

export class SessionRepository {
  constructor(private readonly model: Model<SessionDoc> = SessionModel) {}

  async create(input: {
    userId: string;
    family: string;
    refreshTokenHash: string;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<SessionRecord> {
    const now = new Date();
    const created = await this.model.create({
      userId: input.userId,
      family: input.family,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      lastUsedAt: now,
      revokedAt: null,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
    });
    return toSessionRecord(created.toObject() as unknown as SessionDoc);
  }

  async findByRefreshHash(hash: string): Promise<SessionRecord | null> {
    const doc = await this.model
      .findOne({ refreshTokenHash: String(hash) })
      .lean<SessionDoc>()
      .exec();
    return doc ? toSessionRecord(doc) : null;
  }

  /**
   * Atomically retire a session IF it is still active (compare-and-swap). Returns true if this call
   * won the race. Rotation uses this so two concurrent rotations of the same token cannot both
   * succeed — the loser is treated as token reuse (ADR-0012).
   */
  async revokeIfActive(id: string): Promise<boolean> {
    const res = await this.model
      .findOneAndUpdate({ _id: String(id), revokedAt: null }, { revokedAt: new Date() })
      .lean()
      .exec();
    return res !== null;
  }

  async revokeFamily(family: string): Promise<void> {
    await this.model
      .updateMany({ family: String(family), revokedAt: null }, { revokedAt: new Date() })
      .exec();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.model
      .updateMany({ userId: String(userId), revokedAt: null }, { revokedAt: new Date() })
      .exec();
  }
}

// ── Membership (tenant-scoped) ────────────────────────────────────────────────
interface RoleAssignmentDoc {
  role: string;
  locationScope: string[] | 'ALL';
}

export interface MembershipDoc extends TenantScoped {
  _id: Types.ObjectId;
  userId: string;
  memberId: string | null;
  roles: RoleAssignmentDoc[];
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<MembershipDoc>(
  {
    userId: { type: String, required: true },
    memberId: { type: String, default: null },
    roles: { type: Schema.Types.Mixed, required: true, default: [] },
    status: { type: String, required: true, default: 'active' },
  },
  { timestamps: true },
);
membershipSchema.plugin(tenantGuard);
membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

export const MembershipModel: Model<MembershipDoc> =
  (mongoose.models.Membership as Model<MembershipDoc> | undefined) ??
  mongoose.model<MembershipDoc>('Membership', membershipSchema);

export function toMembership(doc: MembershipDoc): Membership {
  return {
    id: doc._id.toString() as Membership['id'],
    tenantId: doc.tenantId as Membership['tenantId'],
    userId: doc.userId as Membership['userId'],
    memberId: (doc.memberId as Membership['memberId']) ?? null,
    roles: doc.roles as readonly RoleAssignment[],
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class MembershipRepository {
  constructor(private readonly model: Model<MembershipDoc> = MembershipModel) {}

  /** Resolve the active membership for a user in the CURRENT tenant (guard injects tenantId). */
  async findByUserId(userId: string): Promise<Membership | null> {
    const doc = await this.model
      .findOne({ userId: String(userId) })
      .lean<MembershipDoc>()
      .exec();
    return doc ? toMembership(doc) : null;
  }

  /**
   * Request-context BOOTSTRAP lookup (ADR-0012). Runs BEFORE a TenantContext exists (the middleware
   * needs the roles to build the context), so it queries the raw collection with an EXPLICIT tenant
   * filter — never cross-tenant — instead of the guarded model, which would throw with no context.
   */
  async resolveForRequest(tenantId: string, userId: string): Promise<Membership | null> {
    const raw = await this.model.collection.findOne({
      tenantId: String(tenantId),
      userId: String(userId),
    });
    return raw ? toMembership(raw as unknown as MembershipDoc) : null;
  }

  async create(input: {
    userId: string;
    memberId?: string | null;
    roles: readonly RoleAssignment[];
    status?: MembershipStatus;
  }): Promise<Membership> {
    const created = await this.model.create({
      userId: input.userId,
      memberId: input.memberId ?? null,
      roles: input.roles,
      status: input.status ?? 'active',
    });
    return toMembership(created.toObject() as unknown as MembershipDoc);
  }
}
