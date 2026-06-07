import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { MemberRepository, PlatformGrantRepository, TenantRegistryRepository } from '@obikai/db';
import { AuthModule } from '../auth/auth.module.js';
import { PlatformMiddleware } from './platform.middleware.js';
import { PlatformTenantsController } from './tenants.controller.js';

/**
 * The platform (cross-tenant) oversight plane (ADR-0021/0022). Imports AuthModule for TokenService;
 * provides the tenant-global PlatformGrant repo + the platform-aware TenantRegistry + a MemberRepository
 * for per-tenant usage counts. PlatformMiddleware is applied to `/platform/*` (and TenancyMiddleware
 * excludes the same paths) so the request runs under `runAsPlatform`, never a tenant context.
 */
@Module({
  imports: [AuthModule],
  controllers: [PlatformTenantsController],
  providers: [
    PlatformMiddleware,
    { provide: PlatformGrantRepository, useFactory: () => new PlatformGrantRepository() },
    { provide: TenantRegistryRepository, useFactory: () => new TenantRegistryRepository() },
    { provide: MemberRepository, useFactory: () => new MemberRepository() },
  ],
})
export class PlatformModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // IMPORTANT: `forRoutes` strings are compiled by the Express adapter's legacy path-to-regexp
    // (0.1.x), where `(.*)` is an optional `.ext` group that matches NONE of our routes — using it
    // would silently leave this security middleware unbound. `platform/*` is the Express catch-all
    // and also auto-covers any future `/platform/*` controller (verified against Express 4.x).
    consumer.apply(PlatformMiddleware).forRoutes('platform/*');
  }
}
