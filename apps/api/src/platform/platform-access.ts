import type { PlatformActor } from '@obikai/authz';
import type { PlatformGrant } from '@obikai/domain';
import type { Request } from 'express';

/**
 * Pure platform-access decision (ADR-0021/0022), extracted from the middleware so the security logic
 * is unit-testable without booting Nest: a request reaches the platform plane only if it carries a
 * valid access token (→ a userId) AND that user holds a `PlatformGrant`. Anything else is rejected
 * BEFORE `runAsPlatform` is opened.
 */
export type PlatformAccess =
  | { readonly kind: 'ok'; readonly actor: PlatformActor }
  | { readonly kind: 'unauthenticated' }
  | { readonly kind: 'forbidden' };

export function decidePlatformAccess(
  claims: { userId: string } | null,
  grant: PlatformGrant | null,
): PlatformAccess {
  if (!claims) return { kind: 'unauthenticated' };
  if (!grant) return { kind: 'forbidden' };
  return { kind: 'ok', actor: { userId: claims.userId, platformRole: grant.role } };
}

/** Express request augmented by PlatformMiddleware with the resolved platform actor. */
export interface PlatformRequest extends Request {
  platformActor?: PlatformActor;
}

/** Read the actor the middleware resolved; throws if reached without the middleware (mis-wiring). */
export function getPlatformActor(req: PlatformRequest): PlatformActor {
  if (!req.platformActor) {
    throw new Error('platform actor missing — PlatformMiddleware did not run for this route');
  }
  return req.platformActor;
}
