import { Module } from '@nestjs/common';
import { LocalAuthProvider } from '@obikai/adapter-auth-local';
import type { AdapterContext } from '@obikai/adapter-contracts';
import type { AppConfig } from '@obikai/config';
import {
  IdentityRepository,
  MembershipRepository,
  SessionRepository,
  UserRepository,
} from '@obikai/db';
import { adapterLogger } from '../common/logging.js';
import { APP_CONFIG } from '../config.provider.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { DbIdentityStore } from './identity-store.js';
import { TokenService } from './token.service.js';

/** Injection token for the auth adapter's runtime context. */
const AUTH_ADAPTER_CONTEXT = 'AUTH_ADAPTER_CONTEXT';

/**
 * Auth wiring (ADR-0012). Composes the tenant-global identity repositories, the `auth-local`
 * provider (over a db-backed IdentityStore), and the app TokenService. Exports TokenService +
 * MembershipRepository so the tenancy middleware can verify tokens and resolve per-tenant roles.
 */
@Module({
  controllers: [AuthController],
  providers: [
    { provide: UserRepository, useFactory: () => new UserRepository() },
    { provide: IdentityRepository, useFactory: () => new IdentityRepository() },
    { provide: SessionRepository, useFactory: () => new SessionRepository() },
    { provide: MembershipRepository, useFactory: () => new MembershipRepository() },
    {
      provide: AUTH_ADAPTER_CONTEXT,
      useValue: {
        // Real structured logger (was a no-op): register/login rejections + lockouts are now recorded.
        logger: adapterLogger('auth'),
        readSecret: async () => {
          throw new Error('no secret store configured');
        },
        clock: () => new Date(),
      } satisfies AdapterContext,
    },
    {
      provide: DbIdentityStore,
      useFactory: (users: UserRepository, identities: IdentityRepository) =>
        new DbIdentityStore(users, identities),
      inject: [UserRepository, IdentityRepository],
    },
    {
      provide: LocalAuthProvider,
      useFactory: (store: DbIdentityStore, ctx: AdapterContext) =>
        new LocalAuthProvider(store, ctx),
      inject: [DbIdentityStore, AUTH_ADAPTER_CONTEXT],
    },
    {
      provide: TokenService,
      useFactory: (config: AppConfig, sessions: SessionRepository) =>
        new TokenService(
          {
            jwtSecret: config.auth.jwtSecret,
            accessTtl: config.auth.accessTtl,
            refreshTtl: config.auth.refreshTtl,
          },
          sessions,
        ),
      inject: [APP_CONFIG, SessionRepository],
    },
    {
      provide: AuthService,
      useFactory: (auth: LocalAuthProvider, tokens: TokenService) => new AuthService(auth, tokens),
      inject: [LocalAuthProvider, TokenService],
    },
  ],
  exports: [TokenService, MembershipRepository],
})
export class AuthModule {}
