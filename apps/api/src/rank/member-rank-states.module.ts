import { Module } from '@nestjs/common';
import { MemberRankStateRepository, RankSystemRepository } from '@obikai/db';
import { MemberRankStatesController } from './member-rank-states.controller.js';
import { MemberRankStatesService } from './member-rank-states.service.js';

/**
 * Member rank-states feature module, composed from the tenant-scoped @obikai/db repositories
 * (ADR-0004/0015).
 */
@Module({
  controllers: [MemberRankStatesController],
  providers: [
    {
      provide: MemberRankStatesService,
      useFactory: () =>
        new MemberRankStatesService(new MemberRankStateRepository(), new RankSystemRepository()),
    },
  ],
})
export class MemberRankStatesModule {}
