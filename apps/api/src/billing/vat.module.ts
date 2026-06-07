import { Module } from '@nestjs/common';
import type { VatValidationPort } from '@obikai/adapter-contracts';
import { NoneVatProvider, ViesVatProvider } from '@obikai/adapter-vat';
import type { AppConfig } from '@obikai/config';
import { APP_CONFIG } from '../config.provider.js';
import { makeAdapterContext } from '../storage/adapter-context.js';
import { VatValidationService } from './vat-validation.service.js';
import { VatController } from './vat.controller.js';

/** DI token for the resolved VatValidationPort (none/vies), selected by config (ADR-0025). */
const VAT_VALIDATION_PORT = 'VAT_VALIDATION_PORT';

/**
 * VAT validation module (ADR-0025). Selects the existence-check provider from
 * `VAT_VALIDATION_PROVIDER` (ADR-0009): the offline `none` default or EU `vies`. Both are
 * dependency-free (plain `fetch`), so no dynamic import is needed.
 */
@Module({
  controllers: [VatController],
  providers: [
    {
      provide: VAT_VALIDATION_PORT,
      useFactory: async (config: AppConfig): Promise<VatValidationPort> => {
        const ctx = makeAdapterContext('vat');
        const provider =
          config.vatValidation.provider === 'vies'
            ? new ViesVatProvider({ baseUrl: config.vatValidation.viesBaseUrl }, ctx)
            : new NoneVatProvider(ctx);
        await provider.init();
        return provider;
      },
      inject: [APP_CONFIG],
    },
    {
      provide: VatValidationService,
      useFactory: (port: VatValidationPort) => new VatValidationService(port),
      inject: [VAT_VALIDATION_PORT],
    },
  ],
})
export class VatModule {}
