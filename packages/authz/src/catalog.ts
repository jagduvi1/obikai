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
    ['promotion', ['create', 'read', 'list', 'award', 'approve']],
    ['gradingEvent', ['create', 'read', 'list', 'update']],
    ['curriculum', ['read', 'list', 'update']],
    ['discipline', ['read', 'list']],
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
    ['discipline', ['read', 'list']],
    ['rankSystem', ['read', 'list']],
    ['announcement', ['create', 'read', 'list']],
    // Front-desk staff issue invoices, so they may READ the seller billing profile (legal/VAT
    // details printed on invoices), but only the owner edits it.
    ['tenantSettings', ['read']],
  ]),

  // A member: read-mostly self-service. They get tenant-wide read on shared info (classes,
  // announcements) only. Member-OWNED data (their invoices, attendance, promotions, curriculum,
  // profile) is reached via can()'s self-access check (ownerMemberId === actor.memberId), NOT a
  // blanket tenant-wide grant — otherwise a member could list every other member's invoices.
  member: grant([
    ['class', ['read', 'list']],
    ['announcement', ['read', 'list']],
    // Disciplines are shared, non-sensitive reference data (the arts the dojo offers), so members
    // may read them tenant-wide (e.g. to label their own progress) — like classes/announcements.
    ['discipline', ['read', 'list']],
  ]),

  // A guardian's BASE permissions: tenant-wide read on shared, non-sensitive reference data (the
  // class schedule, announcements, the arts the dojo offers) — exactly the member's shared-read set,
  // so a parent can browse the schedule and label a child's progress. A specific minor's OWNED records
  // (profile, attendance, invoices, promotions, …) are reached NOT here but via the Guardianship edge
  // (ADR-0004), checked separately in can() and scoped to the linked minor.
  guardian: grant([
    ['class', ['read', 'list']],
    ['announcement', ['read', 'list']],
    ['discipline', ['read', 'list']],
  ]),
};

/**
 * The default permission set granted on a Guardianship edge — what a parent may do FOR a linked minor:
 * everything the minor could do for themselves (view + manage their profile, progress, attendance,
 * invoices, curriculum) plus signing the minor's waivers and booking/cancelling their classes. Scoped
 * to the minor by `can()`'s guardianship branch (only applies when ownerMemberId === the minor).
 */
export const DEFAULT_GUARDIAN_GRANTS: readonly Permission[] = grant([
  ['member', ['read', 'update']],
  ['invoice', ['read', 'list']],
  ['attendance', ['read', 'list']],
  ['promotion', ['read', 'list']],
  ['curriculum', ['read', 'list']],
  ['waiver', ['read', 'create']],
  ['class', ['create', 'update']],
]);
