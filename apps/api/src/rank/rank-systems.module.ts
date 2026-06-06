import { Module } from '@nestjs/common';
import { RankSystemRepository } from '@obikai/db';
import { RankSystemsController } from './rank-systems.controller.js';
import { RankSystemsService } from './rank-systems.service.js';

/**
 * Rank-systems feature module. The service composes the pure @obikai/rank-engine (validate/mint)
 * with the tenant-scoped RankSystemRepository from @obikai/db (ADR-0004/0005/0015).
 */
@Module({
  controllers: [RankSystemsController],
  providers: [
    {
      provide: RankSystemsService,
      useFactory: () => new RankSystemsService(new RankSystemRepository()),
    },
  ],
})
export class RankSystemsModule {}
