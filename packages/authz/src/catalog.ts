import {
  ACTIONS,
  type Action,
  type Permission,
  RESOURCES,
  type Resource,
  type Role,
} from '@obikai/domain';

/**
 * The default role → permission catalog (ADR-0004). Code-defined and versioned so authorization
 * is deterministic and testable. Owners may define additional CUSTOM roles drawn from this same
 * (resource, action) vocabulary; those are passed to `can()` via `CanOptions.catalog`.
 */

function everything(): Permission[] {
  const out: Permission[] = [];
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) out.push({ resource, action });
  }
  return out;
}

function grant(entries: ReadonlyArray<readonly [Resource, readonly Action[]]>): Permission[] {
  return entries.flatMap(([resource, actions]) => actions.map((action) => ({ resource, action })));
}

export const DEFAULT_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // The owner can do everything within their tenant.
  owner: everything(),

  // Mat-side instructor: sees students, marks attendance, awards rank (human-in-the-loop), runs
  // gradings and curriculum. NOT billing/membership admin.
  instructor: grant([
    ['member', ['read', 'list']],
    ['attendance', ['create', 'read', 'list', 'update']],
    ['class', ['read', 'list']],
    ['promotion', ['read', 'list', 'award', 'approve']],
    ['gradingEvent', ['create', 'read', 'list', 'update']],
    ['curriculum', ['read', 'list', 'update']],
    ['rankSystem', ['read', 'list']],
    ['announcement', ['create', 'read', 'list']],
    ['auditLog', ['read', 'list']],
  ]),

  // Front-desk staff: CRM + scheduling + billing operations, but not rank decisions.
  staff: grant([
    ['member', ['create', 'read', 'list', 'update']],
    ['membership', ['create', 'read', 'list', 'update']],
    ['invoice', ['create', 'read', 'list']],
    ['payment', ['read', 'list']],
    ['class', ['create', 'read', 'list', 'update']],
    ['attendance', ['create', 'read', 'list', 'update']],
    ['waiver', ['create', 'read', 'list']],
    ['announcement', ['create', 'read', 'list']],
  ]),

  // A member: read-mostly self-service. Self-access to their OWN record is additionally granted by
  // can()'s ownership check, independent of this catalog.
  member: grant([
    ['class', ['read', 'list']],
    ['attendance', ['read', 'list']],
    ['promotion', ['read', 'list']],
    ['curriculum', ['read', 'list']],
    ['invoice', ['read', 'list']],
    ['announcement', ['read', 'list']],
  ]),

  // A guardian's BASE permissions; access to a specific minor's records is granted by the
  // Guardianship edge (ADR-0004), checked separately in can().
  guardian: grant([['announcement', ['read', 'list']]]),
};
