import { z } from 'zod';
import type { MemberId, MembershipId, SessionId, TenantId, UserId } from './ids.js';
import type { RoleAssignment } from './rbac.js';

/**
 * Authentication & membership entities (ADR-0012). `User`/`Session` are TENANT-GLOBAL (one human,
 * one login, many dojos); `Membership` is tenant-scoped and resolves a user's roles + linked member
 * within a specific dojo.
 */

export const USER_STATUSES = ['active', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Tenant-global identity. The local password hash lives on a separate Identity record (db). */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const MEMBERSHIP_STATUSES = ['active', 'suspended'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Tenant-scoped link: which roles a user holds at a dojo, and the member record they map to. */
export interface Membership {
  readonly id: MembershipId;
  readonly tenantId: TenantId;
  readonly userId: UserId;
  /** The member record this login maps to in this dojo (for self-access), or null (e.g. staff). */
  readonly memberId: MemberId | null;
  readonly roles: readonly RoleAssignment[];
  readonly status: MembershipStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Tenant-global session backing a rotating refresh token (ADR-0012). */
export interface Session {
  readonly id: SessionId;
  readonly userId: UserId;
  /** Rotation lineage — reuse of a retired token revokes the whole family. */
  readonly family: string;
  /** SHA-256 hash of the opaque refresh token; the raw token is shown to the client once. */
  readonly refreshTokenHash: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly revokedAt: string | null;
  readonly userAgent: string | null;
  readonly ip: string | null;
}

export const registerInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'password must be at least 12 characters'),
});
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

/** Begin a password reset — only the email; the response is identical whether or not it exists. */
export const passwordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

/** Complete a password reset with the emailed token + a new password (same strength as registration). */
export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, 'password must be at least 12 characters'),
});
export type PasswordResetConfirmInput = z.infer<typeof passwordResetConfirmSchema>;
