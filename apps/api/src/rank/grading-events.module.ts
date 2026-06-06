import { Module } from '@nestjs/common';
import { GradingEventRepository, GradingResultRepository } from '@obikai/db';
import { GradingEventsController } from './grading-events.controller.js';
import { GradingEventsService } from './grading-events.service.js';

/**
 * Grading-events feature module, composed from the tenant-scoped @obikai/db repositories
 * (ADR-0004/0015).
 */
@Module({
  controllers: [GradingEventsController],
  providers: [
    {
      provide: GradingEventsService,
      useFactory: () =>
        new GradingEventsService(new GradingEventRepository(), new GradingResultRepository()),
    },
  ],
})
export class GradingEventsModule {}
