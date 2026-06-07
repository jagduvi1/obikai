import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { AppConfig } from '@obikai/config';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuthModule } from './auth/auth.module.js';
import { EnrollmentsModule } from './billing/enrollments.module.js';
import { InvoicesModule } from './billing/invoices.module.js';
import { PlansModule } from './billing/plans.module.js';
import { VatRatesModule } from './billing/vat-rates.module.js';
import { CapabilitiesModule } from './capabilities/capabilities.module.js';
import { APP_CONFIG } from './config.provider.js';
import { HealthModule } from './health/health.module.js';
import { HouseholdsModule } from './households/households.module.js';
import { LocationsModule } from './locations/locations.module.js';
import { MeModule } from './me/me.module.js';
import { MembersModule } from './members/members.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { CurriculumModule } from './rank/curriculum.module.js';
import { DisciplinesModule } from './rank/disciplines.module.js';
import { GradingEventsModule } from './rank/grading-events.module.js';
import { MemberRankStatesModule } from './rank/member-rank-states.module.js';
import { PromotionsModule } from './rank/promotions.module.js';
import { RankSystemsModule } from './rank/rank-systems.module.js';
import { SchedulingModule } from './scheduling/scheduling.module.js';
import { BillingProfileModule } from './settings/billing-profile.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { WaiversModule } from './waivers/waivers.module.js';

/**
 * Composition root (ADR-0003): the app wires everything; libraries stay framework-agnostic. The
 * validated AppConfig is loaded once in main.ts and threaded in via `forRoot`, then exposed to the
 * whole container as a global value provider (APP_CONFIG) so feature modules never read env.
 */
@Global()
@Module({
  imports: [
    HealthModule,
    AuthModule,
    TenancyModule,
    CapabilitiesModule,
    MeModule,
    MembersModule,
    HouseholdsModule,
    LocationsModule,
    VatRatesModule,
    PlansModule,
    EnrollmentsModule,
    InvoicesModule,
    SchedulingModule,
    BillingProfileModule,
    AttendanceModule,
    WaiversModule,
    NotificationsModule,
    PlatformModule,
    DisciplinesModule,
    RankSystemsModule,
    PromotionsModule,
    GradingEventsModule,
    CurriculumModule,
    MemberRankStatesModule,
  ],
})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      // StorageModule is config-driven (fs vs s3, and the fs `/files` route), so it is wired here
      // where the validated AppConfig is available rather than as a static import.
      imports: [StorageModule.forRoot(config)],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
