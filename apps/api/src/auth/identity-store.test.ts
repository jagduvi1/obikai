import { EmailAlreadyRegisteredError } from '@obikai/adapter-auth-local';
import type { IdentityRepository, UserRepository } from '@obikai/db';
import { describe, expect, it } from 'vitest';
import { DbIdentityStore } from './identity-store.js';

/**
 * Verifies the registration race is translated to a typed conflict (GDPR data-minimization, audit
 * M-mongo-leak): a Mongo E11000 from the unique-email index — whose raw message embeds the email —
 * must surface as EmailAlreadyRegisteredError (→ 409, never the default 5xx logger), and the orphan
 * User created first must be rolled back.
 */
const dupKeyError = () =>
  Object.assign(new Error('E11000 duplicate key { emailLower: "a@b.co" }'), { code: 11000 });

class FakeUsers {
  readonly deleted: string[] = [];
  createImpl: () => Promise<{ id: string }> = async () => ({ id: 'u1' });
  async create(): Promise<{ id: string }> {
    return this.createImpl();
  }
  async deleteById(id: string): Promise<void> {
    this.deleted.push(id);
  }
}

class FakeIdentities {
  createImpl: () => Promise<void> = async () => {};
  async create(): Promise<void> {
    return this.createImpl();
  }
}

const make = (users: FakeUsers, identities: FakeIdentities) =>
  new DbIdentityStore(
    users as unknown as UserRepository,
    identities as unknown as IdentityRepository,
  );

const credential = { email: 'a@b.co', passwordHash: 'h', emailVerified: false };

describe('DbIdentityStore.insert (duplicate-email translation)', () => {
  it('translates a duplicate Identity (E11000) to EmailAlreadyRegisteredError + rolls back the User', async () => {
    const users = new FakeUsers();
    const identities = new FakeIdentities();
    identities.createImpl = async () => {
      throw dupKeyError();
    };
    await expect(make(users, identities).insert(credential)).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
    expect(users.deleted).toEqual(['u1']); // orphan User compensated
  });

  it('translates a duplicate User (E11000) to EmailAlreadyRegisteredError', async () => {
    const users = new FakeUsers();
    users.createImpl = async () => {
      throw dupKeyError();
    };
    await expect(make(users, new FakeIdentities()).insert(credential)).rejects.toBeInstanceOf(
      EmailAlreadyRegisteredError,
    );
  });

  it('returns the stored credential on success', async () => {
    const stored = await make(new FakeUsers(), new FakeIdentities()).insert(credential);
    expect(stored).toMatchObject({ subject: 'u1', email: 'a@b.co', emailVerified: false });
  });

  it('rethrows a non-duplicate error unchanged (no false conflict)', async () => {
    const users = new FakeUsers();
    const identities = new FakeIdentities();
    identities.createImpl = async () => {
      throw new Error('network down');
    };
    await expect(make(users, identities).insert(credential)).rejects.toThrow('network down');
    expect(users.deleted).toEqual(['u1']); // still rolled back
  });
});
