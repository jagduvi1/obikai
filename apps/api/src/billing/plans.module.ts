import { Module } from '@nestjs/common';
import { PlanRepository } from '@obikai/db';
import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';

/**
 * Plans feature module. The service is constructed with the tenant-scoped PlanRepository from
 * @obikai/db; the repository's guard reads the per-request TenantContext, so no tenant wiring is
 * needed here (ADR-0004).
 */
@Module({
  controllers: [PlansController],
  providers: [
    {
      provide: PlansService,
      useFactory: () => new PlansService(new PlanRepository()),
    },
  ],
})
export class PlansModule {}
