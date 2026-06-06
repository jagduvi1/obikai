import { Module } from '@nestjs/common';
import { HouseholdRepository, MemberRepository } from '@obikai/db';
import { HouseholdsController } from './households.controller.js';
import { HouseholdsService } from './households.service.js';

/**
 * Households feature module. The service is constructed with the tenant-scoped HouseholdRepository
 * (household CRUD + roster) and MemberRepository (household↔member linking) from @obikai/db; each
 * repository's guard reads the per-request TenantContext, so no tenant wiring is needed here
 * (ADR-0004). Households are gated on the `member` resource as member-family admin.
 */
@Module({
  controllers: [HouseholdsController],
  providers: [
    {
      provide: HouseholdsService,
      useFactory: () => new HouseholdsService(new HouseholdRepository(), new MemberRepository()),
    },
  ],
})
export class HouseholdsModule {}
