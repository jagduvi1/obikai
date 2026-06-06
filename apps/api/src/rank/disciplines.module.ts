import { Module } from '@nestjs/common';
import { DisciplineRepository } from '@obikai/db';
import { DisciplinesController } from './disciplines.controller.js';
import { DisciplinesService } from './disciplines.service.js';

/**
 * Disciplines feature module. The service is constructed with the tenant-scoped DisciplineRepository
 * from @obikai/db; the repository's guard reads the per-request TenantContext (ADR-0004).
 */
@Module({
  controllers: [DisciplinesController],
  providers: [
    {
      provide: DisciplinesService,
      useFactory: () => new DisciplinesService(new DisciplineRepository()),
    },
  ],
})
export class DisciplinesModule {}
