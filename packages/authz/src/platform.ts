import {
  PLATFORM_ACTIONS,
  PLATFORM_RESOURCES,
  type PlatformPermission,
  type PlatformRole,
} from '@obikai/domain';

/**
 * Pure platform (cross-tenant) authorization (ADR-0021). The counterpart to per-tenant `can()`, this
 * governs the operator oversight plane. It is INTENTIONALLY separate so cross-tenant authority can
 * never be confused with, or fall out of, a tenant role: a request only reaches here after the
 * platform-auth guard resolves a `PlatformGrant` and opens `runAsPlatform(...)`.
 */

/** The acting platform principal: a tenant-global user and their platform role (null = no access). */
export interface PlatformActor {
  readonly userId: string;
  readonly platformRole: PlatformRole | null;
}

function everyPlatformPermission(): PlatformPermission[] {
  const out: PlatformPermission[] = [];
  for (const resource of PLATFORM_RESOURCES) {
    for (const action of PLATFORM_ACTIONS) out.push({ resource, action });
  }
  return out;
}

/**
 * Default platform role → permission catalog. `platform_admin` may read/list everything on the
 * (read-only) oversight plane. Code-defined + versioned so platform authorization is deterministic
 * and testable, exactly like `DEFAULT_ROLE_PERMISSIONS`.
 */
export const DEFAULT_PLATFORM_PERMISSIONS: Record<PlatformRole, readonly PlatformPermission[]> = {
  platform_admin: everyPlatformPermission(),
};

/** Decide whether a platform actor may perform an action on the cross-tenant plane. */
export function canPlatform(actor: PlatformActor, target: PlatformPermission): boolean {
  if (actor.platformRole === null) return false;
  const perms = DEFAULT_PLATFORM_PERMISSIONS[actor.platformRole];
  return perms.some((p) => p.resource === target.resource && p.action === target.action);
}
