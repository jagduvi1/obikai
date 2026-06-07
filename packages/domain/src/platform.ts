import { z } from 'zod';
import type { PlatformGrantId, UserId } from './ids.js';

/**
 * Platform (cross-tenant) authorization vocabulary (ADR-0021). Distinct from the per-tenant RBAC in
 * `rbac.ts`: this governs the operator's own oversight plane, which spans ALL tenants and runs under
 * the explicit `runAsPlatform(...)` marker (ADR-0004/0017). v1 is deliberately **read-only** — the
 * platform plane inspects tenants/usage/audit but never mutates tenant data — so the only actions are
 * `read`/`list`.
 *
 * A `PlatformGrant` is TENANT-GLOBAL: it ties a (tenant-global) `User` to a platform role, completely
 * separate from any per-tenant `Membership`. A user with no grant has no platform access at all.
 */

export const PLATFORM_ROLES = ['platform_admin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];
export const platformRoleSchema = z.enum(PLATFORM_ROLES);

export const PLATFORM_RESOURCES = ['tenant', 'usage', 'auditLog'] as const;
export type PlatformResource = (typeof PLATFORM_RESOURCES)[number];

/** Read-only in v1: oversight observes, it never writes tenant data. */
export const PLATFORM_ACTIONS = ['read', 'list'] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export interface PlatformPermission {
  readonly resource: PlatformResource;
  readonly action: PlatformAction;
}

/** Ties a tenant-global user to a platform role. One grant per user. */
export interface PlatformGrant {
  readonly id: PlatformGrantId;
  readonly userId: UserId;
  readonly role: PlatformRole;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const platformGrantInputSchema = z.object({
  userId: z.string().min(1),
  role: platformRoleSchema,
});
export type PlatformGrantInput = z.infer<typeof platformGrantInputSchema>;
