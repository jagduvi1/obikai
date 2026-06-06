import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TenancyMiddleware } from './tenancy.middleware.js';

/**
 * Wires the tenant-context middleware across the request pipeline. Excluded routes answer without a
 * resolved tenant: `/healthz` + `/readyz` (probes have no Host-derived dojo), `/capabilities`
 * (pre-login snapshot), and `/auth/*` (identity is tenant-global, ADR-0012). Imports AuthModule so
 * the middleware can inject TokenService + MembershipRepository.
 */
@Module({
  imports: [AuthModule],
  providers: [TenancyMiddleware],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenancyMiddleware)
      .exclude('healthz', 'readyz', 'capabilities', 'auth/(.*)')
      .forRoutes('*');
  }
}
