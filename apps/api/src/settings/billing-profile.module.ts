import { Module } from '@nestjs/common';
import { BillingProfileRepository } from '@obikai/db';
import { BillingProfileController } from './billing-profile.controller.js';
import { BillingProfileService } from './billing-profile.service.js';

/**
 * Settings: seller billing profile module (ADR-0018). The service is built with the tenant-scoped
 * BillingProfileRepository from @obikai/db; the guard reads the per-request TenantContext, so no
 * tenant wiring is needed here (ADR-0004).
 */
@Module({
  controllers: [BillingProfileController],
  providers: [
    { provide: BillingProfileRepository, useFactory: () => new BillingProfileRepository() },
    {
      provide: BillingProfileService,
      useFactory: (repo: BillingProfileRepository) => new BillingProfileService(repo),
      inject: [BillingProfileRepository],
    },
  ],
})
export class BillingProfileModule {}
