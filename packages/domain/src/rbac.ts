import { z } from 'zod';

/** RBAC vocabulary (ADR-0004). The catalog of roles/resources/actions is code-defined and
 * versioned so authorization (`can()` in the app) stays deterministic and testable. */

export const ROLES = ['owner', 'instructor', 'staff', 'member', 'guardian'] as const;
export type Role = (typeof ROLES)[number];
export const roleSchema = z.enum(ROLES);

export const RESOURCES = [
  'member',
  'membership',
  'invoice',
  'payment',
  'class',
  'attendance',
  'discipline',
  'rankSystem',
  'promotion',
  'gradingEvent',
  'curriculum',
  'waiver',
  'location',
  'role',
  'tenantSettings',
  'auditLog',
  'gdprRequest',
  'announcement',
] as const;
export type Resource = (typeof RESOURCES)[number];
export const resourceSchema = z.enum(RESOURCES);

export const ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'list',
  'approve',
  'award',
  'export',
  'erase',
] as const;
export type Action = (typeof ACTIONS)[number];
export const actionSchema = z.enum(ACTIONS);

export interface Permission {
  readonly resource: Resource;
  readonly action: Action;
}

/** Location scope: an explicit set of location ids, or 'ALL' for tenant-wide. */
export type LocationScope = readonly string[] | 'ALL';

export interface RoleAssignment {
  readonly role: Role | `custom:${string}`;
  readonly locationScope: LocationScope;
}
