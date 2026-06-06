import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig } from '@obikai/config';
import { CapabilitiesModule } from './capabilities/capabilities.module.js';
import { APP_CONFIG } from './config.provider.js';
import { HealthModule } from './health/health.module.js';
import { MembersModule } from './members/members.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

/**
 * Composition root (ADR-0003): the app wires everything; libraries stay framework-agnostic. The
 * validated AppConfig is loaded once in main.ts and threaded in via `forRoot`, then exposed to the
 * whole container as a global value provider (APP_CONFIG) so feature modules never read env.
 */
@Global()
@Module({
  imports: [HealthModule, TenancyModule, CapabilitiesModule, MembersModule],
})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
