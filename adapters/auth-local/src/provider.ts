/**
 * `LocalAuthProvider` — the default `AuthPort` implementation (ADR-0004). It ONLY verifies
 * identity: it hashes/checks passwords and returns an `Identity`. Sessions, JWT access tokens, and
 * rotating-refresh issuance/revocation live in the app-layer token service, NOT here, so switching
 * to a future OIDC adapter never touches session logic. OIDC is a separate future adapter, so the
 * optional `beginOidc`/`completeOidc` methods are intentionally absent here.
 *
 * Identity persistence is INJECTED via `IdentityStore` (ADR-0003: no DB coupling in adapters).
 */

import type {
  AdapterContext,
  AuthCapability,
  AuthPort,
  HealthStatus,
  Identity,
  RegisterPasswordInput,
  SetPasswordInput,
  VerifyPasswordInput,
} from '@obikai/adapter-contracts';
import { DECOY_HASH, hashPassword, verifyPassword } from './hash.js';
import { EmailAlreadyRegisteredError, type IdentityStore, type StoredCredential } from './store.js';

const PROVIDER_ID = 'local';
const CAPABILITIES: ReadonlySet<AuthCapability> = new Set<AuthCapability>(['password', 'mfa-totp']);

/** Normalise an email for storage and lookup: trim + lowercase. */
function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toIdentity(credential: StoredCredential): Identity {
  return {
    subject: credential.subject,
    email: credential.email,
    emailVerified: credential.emailVerified,
    provider: PROVIDER_ID,
    tenantScoped: false,
  };
}

export class LocalAuthProvider implements AuthPort {
  readonly kind = 'auth' as const;
  readonly providerId = PROVIDER_ID;
  readonly capabilities = CAPABILITIES;

  readonly #store: IdentityStore;
  readonly #ctx: AdapterContext;

  constructor(store: IdentityStore, ctx: AdapterContext) {
    this.#store = store;
    this.#ctx = ctx;
  }

  async init(): Promise<void> {
    // No external resource to open: verification is purely in-process (node:crypto scrypt).
  }

  async dispose(): Promise<void> {
    // Nothing to release.
  }

  async health(): Promise<HealthStatus> {
    return { ok: true, detail: 'local password verification (scrypt)' };
  }

  async registerPassword(input: RegisterPasswordInput): Promise<Identity> {
    const email = normaliseEmail(input.email);
    const existing = await this.#store.findByEmail(email);
    if (existing !== null) {
      // Do NOT log the email (PII/data-minimization) — the typed error already conveys the reason.
      this.#ctx.logger.warn('local auth: register rejected, email already registered');
      throw new EmailAlreadyRegisteredError(email);
    }
    const passwordHash = hashPassword(input.password);
    const stored = await this.#store.insert({ email, passwordHash, emailVerified: false });
    this.#ctx.logger.info('local auth: registered credential', { subject: stored.subject });
    return toIdentity(stored);
  }

  async verifyPassword(input: VerifyPasswordInput): Promise<Identity | null> {
    const email = normaliseEmail(input.email);
    const credential = await this.#store.findByEmail(email);
    if (credential === null) {
      // Burn comparable CPU against a decoy so "unknown email" and "wrong password" take similar
      // time — closes the login timing/enumeration oracle.
      verifyPassword(input.password, DECOY_HASH);
      return null;
    }
    if (!verifyPassword(input.password, credential.passwordHash)) {
      return null;
    }
    return toIdentity(credential);
  }

  async setPassword(input: SetPasswordInput): Promise<boolean> {
    // Hash here (the adapter owns the algorithm); the store only persists the encoded string. Keyed
    // by subject so reset (token→userId) and change (session→userId) never need to re-prompt the email.
    const passwordHash = hashPassword(input.password);
    const updated = await this.#store.updatePasswordHash(input.subject, passwordHash);
    if (updated) this.#ctx.logger.info('local auth: password updated', { subject: input.subject });
    return updated;
  }
}
