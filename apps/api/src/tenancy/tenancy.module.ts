import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { TenancyMiddleware } from './tenancy.middleware.js';

/**
 * Wires the tenant-context middleware across the request pipeline. Health probes are excluded:
 * `/healthz` and `/readyz` must answer without a resolved tenant (a probe has no Host-derived
 * dojo), and `/capabilities` is a pre-login, tenant-agnostic snapshot.
 */
@Module({
  providers: [TenancyMiddleware],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenancyMiddleware).exclude('healthz', 'readyz', 'capabilities').forRoutes('*');
  }
}
