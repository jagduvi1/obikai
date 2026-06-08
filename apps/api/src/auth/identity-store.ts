import {
  EmailAlreadyRegisteredError,
  type IdentityStore,
  type NewCredential,
  type StoredCredential,
} from '@obikai/adapter-auth-local';
import type { IdentityRepository, UserRepository } from '@obikai/db';

/** A MongoDB duplicate-key (E11000) error — the unique email index rejected a concurrent registration. */
function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

/**
 * DbIdentityStore — wires the `auth-local` adapter's injected `IdentityStore` port (ADR-0003) to
 * the tenant-global `User` + `Identity` collections in @obikai/db. The adapter normalizes the email
 * before calling here. Creating a credential creates the canonical `User` then its local `Identity`.
 */
export class DbIdentityStore implements IdentityStore {
  constructor(
    private readonly users: UserRepository,
    private readonly identities: IdentityRepository,
  ) {}

  async findByEmail(email: string): Promise<StoredCredential | null> {
    const rec = await this.identities.findByEmailLower('local', email.toLowerCase());
    if (!rec) return null;
    return {
      subject: rec.userId,
      email: rec.email,
      passwordHash: rec.passwordHash,
      emailVerified: rec.emailVerified,
    };
  }

  async insert(credential: NewCredential): Promise<StoredCredential> {
    // No multi-doc transaction on a single-node self-host, so compensate: if the Identity create
    // fails (e.g. a concurrent duplicate trips the unique index), roll back the just-created User
    // so a failed registration can't leave an orphan (ADR-0012 review fix). The User + Identity
    // unique indexes remain the real backstop.
    let user: Awaited<ReturnType<UserRepository['create']>>;
    try {
      user = await this.users.create({
        email: credential.email,
        emailVerified: credential.emailVerified,
      });
    } catch (error) {
      // A concurrent registration won the unique-email race. Translate the raw Mongo 11000 (whose
      // message embeds the email) into a typed error → the controller returns 409, so the email never
      // reaches Nest's default 5xx exception logger (GDPR data-minimization, audit M-mongo-leak).
      if (isDuplicateKey(error)) throw new EmailAlreadyRegisteredError(credential.email);
      throw error;
    }
    try {
      await this.identities.create({
        userId: user.id,
        provider: 'local',
        email: credential.email,
        passwordHash: credential.passwordHash,
        emailVerified: credential.emailVerified,
      });
    } catch (error) {
      await this.users.deleteById(user.id).catch(() => undefined);
      if (isDuplicateKey(error)) throw new EmailAlreadyRegisteredError(credential.email);
      throw error;
    }
    return {
      subject: user.id,
      email: credential.email,
      passwordHash: credential.passwordHash,
      emailVerified: credential.emailVerified,
    };
  }

  async updatePasswordHash(subject: string, passwordHash: string): Promise<boolean> {
    return this.identities.updatePasswordHashByUserId(subject, passwordHash, 'local');
  }
}
