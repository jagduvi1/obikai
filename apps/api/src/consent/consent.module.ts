import { Module } from '@nestjs/common';
import { AuditLogRepository, ConsentRepository } from '@obikai/db';
import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';

/**
 * Consent feature module (GDPR Art. 6(1)(a)/7). The service is built with the tenant-scoped
 * ConsentRepository and AuditLogRepository from @obikai/db; both guards read the per-request
 * TenantContext (ADR-0004). Every grant/withdrawal is recorded on the tenant's audit chain (ADR-0026).
 */
@Module({
  controllers: [ConsentController],
  providers: [
    {
      provide: ConsentService,
      useFactory: () => new ConsentService(new ConsentRepository(), new AuditLogRepository()),
    },
  ],
})
export class ConsentModule {}
