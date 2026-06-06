import type { AuthPort } from '@obikai/adapter-contracts';
import type { LoginInput, RegisterInput } from '@obikai/domain';
import type { IssuedTokens, SessionMeta, TokenService } from './token.service.js';

/**
 * AuthService (ADR-0012). Orchestrates the `auth-local` AuthPort (password verification only) and
 * the TokenService (sessions/JWT). Registration creates a tenant-GLOBAL account; membership to a
 * dojo is granted separately (staff invite, or the create-owner bootstrap) — registering does not
 * by itself grant access to any tenant.
 */
export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}

export class AuthService {
  constructor(
    private readonly auth: AuthPort,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput, meta: SessionMeta = {}): Promise<IssuedTokens> {
    await this.auth.registerPassword({ email: input.email, password: input.password });
    const identity = await this.auth.verifyPassword({
      email: input.email,
      password: input.password,
    });
    if (!identity) throw new InvalidCredentialsError(); // should not happen right after register
    return this.tokens.startSession(identity.subject, meta);
  }

  async login(input: LoginInput, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const identity = await this.auth.verifyPassword({
      email: input.email,
      password: input.password,
    });
    if (!identity) throw new InvalidCredentialsError();
    return this.tokens.startSession(identity.subject, meta);
  }

  async refresh(refreshToken: string, meta: SessionMeta = {}): Promise<IssuedTokens> {
    const rotated = await this.tokens.rotate(refreshToken, meta);
    if (!rotated) throw new InvalidCredentialsError();
    return rotated;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }
}
