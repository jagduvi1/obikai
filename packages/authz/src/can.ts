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

/** Member-OWNED resources a member may read/list for THEIR OWN member record via self-access. */
const SELF_READABLE_RESOURCES: ReadonlySet<Resource> = new Set<Resource>([
  'member',
  'invoice',
  'attendance',
  'promotion',
  'curriculum',
]);

function permissionsForRole(
  role: Role | `custom:${string}`,
  catalog: CanOptions['catalog'],
): readonly Permission[] | undefined {
  if (catalog && role in catalog) return catalog[role];
  if (role in DEFAULT_ROLE_PERMISSIONS) return DEFAULT_ROLE_PERMISSIONS[role as Role];
  return undefined;
}

/**
 * The platform's own actor for automated, tenant-authorized background work (billing runs, dunning).
 * It carries the `owner` role so it may perform exactly the billing/payment operations a tenant
 * owner could — but it is ONLY ever used by the worker inside an EXPLICIT tenant context (ADR-0004),
 * where the audit trail records a null user + the job id. It is never a request principal, and it is
 * still bound by the tenant guard, so it cannot act across tenants. (A dedicated least-privilege
 * system role is a possible future refinement; `owner` avoids threading a custom catalog through
 * every `can()` call.)
 */
export function systemActor(): AuthzActor {
  return { userId: 'system', roles: [{ role: 'owner', locationScope: 'ALL' }] };
}

export function can(actor: AuthzActor, target: AuthzTarget, opts: CanOptions = {}): boolean {
  const { resource, action, locationId, ownerMemberId } = target;

  // 1) Role grants (location-aware).
  for (const assignment of actor.roles) {
    if (!locationCovers(assignment.locationScope, locationId)) continue;
    const perms = permissionsForRole(assignment.role, opts.catalog);
    if (perms && hasPermission(perms, resource, action)) return true;
  }

  // 2) Self-access: for their OWN member record (ownerMemberId === actor.memberId), a member may
  // read/update their profile and read/list the member-owned resources tied to it (invoices,
  // attendance, promotions, curriculum). This — not a tenant-wide catalog grant — is how members
  // see their own data, so they can never enumerate other members'.
  if (
    ownerMemberId !== undefined &&
    actor.memberId !== undefined &&
    ownerMemberId === actor.memberId
  ) {
    if (resource === 'member' && (action === 'read' || action === 'update')) return true;
    if (SELF_READABLE_RESOURCES.has(resource) && (action === 'read' || action === 'list'))
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
