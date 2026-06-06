import { Module } from '@nestjs/common';
import { CurriculumCompletionRepository, CurriculumItemRepository } from '@obikai/db';
import { CurriculumController } from './curriculum.controller.js';
import { CurriculumService } from './curriculum.service.js';

/**
 * Curriculum feature module, composed from the tenant-scoped @obikai/db repositories
 * (ADR-0004/0015).
 */
@Module({
  controllers: [CurriculumController],
  providers: [
    {
      provide: CurriculumService,
      useFactory: () =>
        new CurriculumService(new CurriculumItemRepository(), new CurriculumCompletionRepository()),
    },
  ],
})
export class CurriculumModule {}
