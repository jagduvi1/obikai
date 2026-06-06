import { Module } from '@nestjs/common';
import { VatRateRepository } from '@obikai/db';
import { VatRatesController } from './vat-rates.controller.js';
import { VatRatesService } from './vat-rates.service.js';

/**
 * VAT rates feature module. The service is constructed with the tenant-scoped VatRateRepository
 * from @obikai/db; the repository's guard reads the per-request TenantContext, so no tenant wiring
 * is needed here (ADR-0004).
 */
@Module({
  controllers: [VatRatesController],
  providers: [
    {
      provide: VatRatesService,
      useFactory: () => new VatRatesService(new VatRateRepository()),
    },
  ],
})
export class VatRatesModule {}
