import type { Adapter } from './base.js';

/**
 * AuthPort — the adapter ONLY verifies identity (ADR-0004). Sessions, JWT access tokens, and
 * rotating-refresh issuance/revocation live in ONE app-layer token service, not per adapter, so
 * switching from local password to OIDC never changes the session/authorization logic. The
 * default `LocalAuthProvider` (argon2id) needs no external service; OIDC is optional, never
 * required. RBAC is enforced ABOVE this port.
 */
export type AuthCapability = 'password' | 'mfa-totp' | 'oidc';

export interface Identity {
  readonly subject: string;
  readonly email?: string;
  readonly emailVerified: boolean;
  /** Which auth method produced this identity, e.g. 'local' | 'oidc'. */
  readonly provider: string;
  /** Identity is tenant-GLOBAL (ADR-0004): one human → many dojos via per-tenant Membership. */
  readonly tenantScoped: false;
}

export interface VerifyPasswordInput {
  readonly email: string;
  readonly password: string;
}

export interface RegisterPasswordInput {
  readonly email: string;
  readonly password: string;
}

export interface BeginOidcInput {
  readonly redirectUri: string;
}

export interface AuthPort extends Adapter<AuthCapability> {
  readonly kind: 'auth';
  registerPassword(input: RegisterPasswordInput): Promise<Identity>;
  verifyPassword(input: VerifyPasswordInput): Promise<Identity | null>;
  /** Optional federation. Absent capability/methods ⇒ OIDC is simply unavailable, never required. */
  beginOidc?(input: BeginOidcInput): Promise<{ authorizeUrl: string; stateRef: string }>;
  completeOidc?(input: { code: string; stateRef: string }): Promise<Identity>;
}
