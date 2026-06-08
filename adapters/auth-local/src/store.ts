/**
 * Injected identity persistence. The adapter MUST NOT couple to a DB (ADR-0003: adapters depend
 * only on adapter-contracts + domain + their own vendor SDK). The app composition root supplies a
 * concrete `IdentityStore` backed by `@obikai/db`; tests supply an in-memory one.
 *
 * Per ADR-0004 the local credential is tenant-GLOBAL (one human, many dojos via Membership), so
 * email lookup is global and never scoped to a tenant here.
 */

/** A stored local-password credential record. The `passwordHash` is the encoded scrypt string. */
export interface StoredCredential {
  /** Stable subject identifier for the identity (the tenant-global User id). */
  readonly subject: string;
  /** Normalised (lowercased) email — uniqueness is enforced by the store. */
  readonly email: string;
  /** Encoded password hash, see `hash.ts`. */
  readonly passwordHash: string;
  readonly emailVerified: boolean;
}

/** What the store needs to accept on insert. The store assigns/validates uniqueness. */
export interface NewCredential {
  readonly email: string;
  readonly passwordHash: string;
  readonly emailVerified: boolean;
}

export interface IdentityStore {
  /** Look up a credential by normalised email, or `null` if none exists. */
  findByEmail(email: string): Promise<StoredCredential | null>;
  /** Persist a new credential and return the stored record (with its assigned subject). */
  insert(credential: NewCredential): Promise<StoredCredential>;
  /** Replace the password hash for the credential owned by `subject`. Returns true if one was
   *  updated, false if the subject has no local credential. */
  updatePasswordHash(subject: string, passwordHash: string): Promise<boolean>;
}

/** Raised when registering an email that already has a local credential. */
export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`A local credential already exists for email="${email}"`);
    this.name = 'EmailAlreadyRegisteredError';
  }
}
