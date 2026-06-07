/**
 * @obikai/authz — pure, deterministic RBAC (ADR-0004). Depends only on @obikai/domain. The
 * server-side `can()` is the security boundary; the same shapes can build a CASL ability for the
 * UI to hide controls, but the UI is never the boundary.
 */
export {
  can,
  systemActor,
  type AuthzActor,
  type AuthzTarget,
  type CanOptions,
  type GuardianshipGrant,
} from './can.js';
export { DEFAULT_ROLE_PERMISSIONS } from './catalog.js';
export { canPlatform, DEFAULT_PLATFORM_PERMISSIONS, type PlatformActor } from './platform.js';
