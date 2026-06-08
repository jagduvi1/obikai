import { Module } from '@nestjs/common';
import { LocalAuthProvider } from '@obikai/adapter-auth-local';
import type { AppConfig } from '@obikai/config';
import {
  AuditLogRepository,
  IdentityRepository,
  MemberInviteTokenRepository,
  MemberRepository,
  MembershipRepository,
  type TenantContext,
  UserRepository,
  runInTenantContext,
} from '@obikai/db';
import { AuthModule } from '../auth/auth.module.js';
import { TokenService } from '../auth/token.service.js';
import { APP_CONFIG } from '../config.provider.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { InvitesController } from './invites.controller.js';
import { MemberInviteService } from './member-invite.service.js';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

/**
 * Members feature module. `MembersService` is built with the tenant-scoped MemberRepository + per-tenant
 * AuditLogRepository (ADR-0004/0026). `MemberInviteService` (onboarding) additionally needs the account
 * plane — the local auth provider + TokenService from AuthModule — and a `withTenant` that opens an
 * explicit tenant context for the PUBLIC accept endpoint (which has none). `/invites/accept` is excluded
 * from TenancyMiddleware (see tenancy.module.ts).
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [MembersController, InvitesController],
  providers: [
    {
      provide: MembersService,
      useFactory: () => new MembersService(new MemberRepository(), new AuditLogRepository()),
    },
    {
      provide: MemberInviteService,
      useFactory: (config: AppConfig, account: LocalAuthProvider, tokens: TokenService) => {
        const users = new UserRepository();
        const identities = new IdentityRepository();
        return new MemberInviteService({
          members: new MemberRepository(),
          invites: new MemberInviteTokenRepository(),
          account,
          memberships: new MembershipRepository(),
          sessions: tokens,
          verifier: {
            markVerified: async (userId) => {
              await users.markEmailVerified(userId);
              await identities.markEmailVerifiedByUserId(userId, 'local');
            },
          },
          audit: new AuditLogRepository(),
          // Open an explicit tenant context for the tenant carried by the (trusted) invite token.
          withTenant: <T>(tenantId: string, userId: string, fn: () => Promise<T>): Promise<T> => {
            const ctx: TenantContext = {
              tenantId,
              userId,
              sessionId: null,
              roles: [],
              memberId: null,
              requestId: `invite-accept:${tenantId}`,
              tenancy: config.tenancy,
            };
            return runInTenantContext(ctx, fn);
          },
        });
      },
      inject: [APP_CONFIG, LocalAuthProvider, TokenService],
    },
  ],
})
export class MembersModule {}
