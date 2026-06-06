import type { AdapterContext, Logger, SecretRef } from '@obikai/adapter-contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalAuthFactory } from './factory.js';
import { hashPassword, verifyPassword } from './hash.js';
import { LocalAuthProvider } from './provider.js';
import {
  EmailAlreadyRegisteredError,
  type IdentityStore,
  type NewCredential,
  type StoredCredential,
} from './store.js';

/** In-memory IdentityStore for tests (no DB coupling, ADR-0003). */
class MemoryStore implements IdentityStore {
  #seq = 0;
  readonly #byEmail = new Map<string, StoredCredential>();

  async findByEmail(email: string): Promise<StoredCredential | null> {
    return this.#byEmail.get(email) ?? null;
  }

  async insert(credential: NewCredential): Promise<StoredCredential> {
    this.#seq += 1;
    const stored: StoredCredential = {
      subject: `user-${this.#seq}`,
      email: credential.email,
      passwordHash: credential.passwordHash,
      emailVerified: credential.emailVerified,
    };
    this.#byEmail.set(stored.email, stored);
    return stored;
  }
}

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const ctx: AdapterContext = {
  logger: noopLogger,
  async readSecret(_ref: SecretRef): Promise<string> {
    throw new Error('local auth requires no secrets');
  },
  clock() {
    return new Date('2026-06-06T00:00:00.000Z');
  },
};

describe('LocalAuthProvider', () => {
  let provider: LocalAuthProvider;

  beforeEach(async () => {
    provider = new LocalAuthProvider(new MemoryStore(), ctx);
    await provider.init();
  });

  it('exposes the expected port shape and capabilities', () => {
    expect(provider.kind).toBe('auth');
    expect(provider.providerId).toBe('local');
    expect(provider.capabilities.has('password')).toBe(true);
    expect(provider.capabilities.has('mfa-totp')).toBe(true);
    expect(provider.capabilities.has('oidc')).toBe(false);
  });

  it('reports healthy', async () => {
    await expect(provider.health()).resolves.toMatchObject({ ok: true });
    await provider.dispose();
  });

  it('register then verify succeeds and yields a tenant-global identity', async () => {
    const registered = await provider.registerPassword({
      email: 'Sensei@Dojo.example',
      password: 'correct horse battery staple',
    });
    expect(registered.provider).toBe('local');
    expect(registered.tenantScoped).toBe(false);
    expect(registered.email).toBe('sensei@dojo.example');

    const verified = await provider.verifyPassword({
      email: 'sensei@dojo.example',
      password: 'correct horse battery staple',
    });
    expect(verified).not.toBeNull();
    expect(verified?.subject).toBe(registered.subject);
    expect(verified?.tenantScoped).toBe(false);
  });

  it('verify fails (null) for a wrong password', async () => {
    await provider.registerPassword({
      email: 'member@dojo.example',
      password: 'right-password',
    });
    const verified = await provider.verifyPassword({
      email: 'member@dojo.example',
      password: 'wrong-password',
    });
    expect(verified).toBeNull();
  });

  it('verify returns null for an unknown email', async () => {
    const verified = await provider.verifyPassword({
      email: 'nobody@dojo.example',
      password: 'whatever',
    });
    expect(verified).toBeNull();
  });

  it('rejects re-registering an existing email (case-insensitive)', async () => {
    await provider.registerPassword({ email: 'dup@dojo.example', password: 'pw1' });
    await expect(
      provider.registerPassword({ email: 'DUP@dojo.example', password: 'pw2' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });
});

describe('createLocalAuthFactory', () => {
  it('builds a ProviderFactory that creates a LocalAuthProvider', () => {
    const factory = createLocalAuthFactory(new MemoryStore());
    expect(factory.kind).toBe('auth');
    expect(factory.providerId).toBe('local');
    expect(factory.paramsSchema.parse({})).toEqual({});
    const provider = factory.create(
      { kind: 'auth', providerId: 'local', tenantId: null, params: {}, secrets: {} },
      ctx,
    );
    expect(provider).toBeInstanceOf(LocalAuthProvider);
  });
});

describe('hashPassword / verifyPassword', () => {
  it('produces a self-describing scrypt encoding and round-trips', () => {
    const encoded = hashPassword('s3cret');
    expect(encoded.startsWith('scrypt$')).toBe(true);
    expect(encoded.split('$')).toHaveLength(4);
    expect(verifyPassword('s3cret', encoded)).toBe(true);
    expect(verifyPassword('nope', encoded)).toBe(false);
  });

  it('uses a fresh random salt per call', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('returns false for malformed encodings instead of throwing', () => {
    expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false);
    expect(verifyPassword('x', 'scrypt$16384$deadbeef')).toBe(false);
    expect(verifyPassword('x', 'bcrypt$16384$aa$bb')).toBe(false);
  });
});
