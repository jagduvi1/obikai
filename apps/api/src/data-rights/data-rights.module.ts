import { Module } from '@nestjs/common';
import { AuditLogRepository, buildRopaRegistry } from '@obikai/db';
import { DataExportService } from './data-export.service.js';
import { DataRightsController } from './data-rights.controller.js';

/**
 * Data-subject rights module (GDPR Arts. 15/20; erasure added in G6). The ROPA registry is built once
 * at boot and shared; the export service walks it under the per-request TenantContext (ADR-0004/0026).
 */
@Module({
  controllers: [DataRightsController],
  providers: [
    {
      provide: DataExportService,
      useFactory: () => new DataExportService(buildRopaRegistry(), new AuditLogRepository()),
    },
  ],
})
export class DataRightsModule {}
