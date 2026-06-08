import { Module } from '@nestjs/common';
import { ReportingRepository } from '@obikai/db';
import { ReportingController } from './reporting.controller.js';
import { ReportingService } from './reporting.service.js';

/**
 * Reporting feature module (scope §4.9). ReportingService composes the tenant-guarded
 * ReportingRepository aggregates into the owner dashboard; the guard scopes every query by the
 * per-request TenantContext (ADR-0004), so no tenant wiring is needed here.
 */
@Module({
  controllers: [ReportingController],
  providers: [
    {
      provide: ReportingService,
      useFactory: () => new ReportingService(new ReportingRepository()),
    },
  ],
})
export class ReportingModule {}
