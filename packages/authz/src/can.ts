import type {
  Action,
  LocationScope,
  Permission,
  Resource,
  Role,
  RoleAssignment,
} from '@obikai/domain';
import { DEFAULT_ROLE_PERMISSIONS } from './catalog.js';

/**
 * Deterministic, pure authorization (ADR-0004). Tenant scoping is already guaranteed by the
 * request context (ADR-0004 `tenantGuard`); `can()` decides WHAT an actor may do within the
 * already-resolved tenant. It never calls AI — `award`/`approve` on promotions are role-gated
 * here, keeping a human in the rank-decision loop (invariant 4).
 */

export interface AuthzActor {
  readonly userId: string;
  /** The actor's own member id in this tenant, if they are a member (enables self-access). */
  readonly memberId?: string;
  readonly roles: readonly RoleAssignment[];
}

export interface AuthzTarget {
  readonly resource: Resource;
  readonly action: Action;
  /** The location the resource belongs to; omit for tenant-wide resources. */
  readonly locationId?: string;
  /** The member who "owns" the target record — enables self-access and guardianship. */
  readonly ownerMemberId?: string;
}

/** A guardian→minor delegation edge granting a constrained permission set over the minor's records. */
export interface GuardianshipGrant {
  readonly guardianUserId: string;
  readonly minorMemberId: string;
  readonly grants: readonly Permission[];
  readonly revokedAt?: Date | null;
}

export interface CanOptions {
  /** Owner-defined custom roles (`custom:*`) mapped to permissions; merged over the defaults. */
  readonly catalog?: Readonly<Record<string, readonly Permission[]>>;
  readonly guardianships?: readonly GuardianshipGrant[];
}

function locationCovers(scope: LocationScope, locationId: string | undefined): boolean {
  if (scope === 'ALL') return true;
  if (locationId === undefined) return false; // a location-scoped role cannot act tenant-wide
  return scope.includes(locationId);
}

function hasPermission(perms: readonly Permission[], resource: Resource, action: Action): boolean {
  return perms.some((p) => p.resource === resource && p.action === action);
}

function permissionsForRole(
  role: Role | `custom:${string}`,
  catalog: CanOptions['catalog'],
): readonly Permission[] | undefined {
  if (catalog && role in catalog) return catalog[role];
  if (role in DEFAULT_ROLE_PERMISSIONS) return DEFAULT_ROLE_PERMISSIONS[role as Role];
  return undefined;
}

export function can(actor: AuthzActor, target: AuthzTarget, opts: CanOptions = {}): boolean {
  const { resource, action, locationId, ownerMemberId } = target;

  // 1) Role grants (location-aware).
  for (const assignment of actor.roles) {
    if (!locationCovers(assignment.locationScope, locationId)) continue;
    const perms = permissionsForRole(assignment.role, opts.catalog);
    if (perms && hasPermission(perms, resource, action)) return true;
  }

  // 2) Self-access: a member may read/update their OWN member record regardless of role catalog.
  if (
    ownerMemberId !== undefined &&
    actor.memberId !== undefined &&
    ownerMemberId === actor.memberId &&
    resource === 'member' &&
    (action === 'read' || action === 'update')
  ) {
    return true;
  }

  // 3) Guardianship: a guardian may act on a linked, non-revoked minor per the granted permissions.
  if (ownerMemberId !== undefined && opts.guardianships) {
    for (const g of opts.guardianships) {
      if (g.guardianUserId !== actor.userId || g.minorMemberId !== ownerMemberId) continue;
      if (g.revokedAt != null) continue;
      if (hasPermission(g.grants, resource, action)) return true;
    }
  }

  return false;
}
