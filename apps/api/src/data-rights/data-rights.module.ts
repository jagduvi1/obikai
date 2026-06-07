import { Module } from '@nestjs/common';
import type { StoragePort } from '@obikai/adapter-contracts';
import { AuditLogRepository, MemberRepository, buildRopaRegistry } from '@obikai/db';
import { STORAGE_PORT } from '../storage/storage.tokens.js';
import { DataExportService } from './data-export.service.js';
import { DataRightsController } from './data-rights.controller.js';
import { ErasureController } from './erasure.controller.js';
import { ErasureService } from './erasure.service.js';

/**
 * Data-subject rights module (GDPR Arts. 15/17/20). Self-service export (`/me/data-export`) walks the
 * ROPA registry; admin-initiated erasure (`POST /members/:id/erasure`) runs the audited erasure over
 * @obikai/db, deleting waiver blobs via the configured storage adapter. All run under the per-request
 * TenantContext (ADR-0004/0026).
 */
@Module({
  controllers: [DataRightsController, ErasureController],
  providers: [
    { provide: MemberRepository, useFactory: () => new MemberRepository() },
    {
      provide: DataExportService,
      useFactory: () => new DataExportService(buildRopaRegistry(), new AuditLogRepository()),
    },
    {
      provide: ErasureService,
      useFactory: (members: MemberRepository, storage: StoragePort) =>
        new ErasureService(members, storage, new AuditLogRepository()),
      inject: [MemberRepository, STORAGE_PORT],
    },
  ],
})
export class DataRightsModule {}
