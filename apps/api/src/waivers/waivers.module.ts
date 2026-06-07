import { Module } from '@nestjs/common';
import type { StoragePort } from '@obikai/adapter-contracts';
import { WaiverSignatureRepository, WaiverTemplateRepository } from '@obikai/db';
import { STORAGE_PORT } from '../storage/storage.tokens.js';
import { WaiversController } from './waivers.controller.js';
import { WaiversService } from './waivers.service.js';

/**
 * Waivers feature module (ADR-0014, scope §4.10). The service is constructed with the tenant-scoped
 * WaiverTemplate/WaiverSignature repositories from @obikai/db; the repositories' guard reads the
 * per-request TenantContext, so no tenant wiring is needed here (ADR-0004).
 *
 * Repos are VALUE imports provided via useFactory tokens, then injected into the service factory —
 * matching the members module exactly (apps/api has verbatimModuleSyntax off for this reason).
 */
@Module({
  controllers: [WaiversController],
  providers: [
    {
      provide: WaiverTemplateRepository,
      useFactory: () => new WaiverTemplateRepository(),
    },
    {
      provide: WaiverSignatureRepository,
      useFactory: () => new WaiverSignatureRepository(),
    },
    {
      provide: WaiversService,
      useFactory: (
        templates: WaiverTemplateRepository,
        signatures: WaiverSignatureRepository,
        storage: StoragePort,
      ) => new WaiversService(templates, signatures, storage),
      inject: [WaiverTemplateRepository, WaiverSignatureRepository, STORAGE_PORT],
    },
  ],
})
export class WaiversModule {}
