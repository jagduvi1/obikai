import { Module } from '@nestjs/common';
import {
  AttendanceRepository,
  CurriculumCompletionRepository,
  GradingResultRepository,
  MemberRankStateRepository,
  MemberRepository,
  PromotionRepository,
  RankSystemRepository,
} from '@obikai/db';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsService } from './promotions.service.js';

/**
 * Promotions feature module. The service composes the pure @obikai/rank-engine with the
 * tenant-scoped @obikai/db repositories that supply the student snapshot (rank state, attendance,
 * grading, curriculum, member DOB) and persist the immutable promotion (ADR-0004/0005/0015).
 */
@Module({
  controllers: [PromotionsController],
  providers: [
    {
      provide: PromotionsService,
      useFactory: () =>
        new PromotionsService({
          rankStates: new MemberRankStateRepository(),
          versions: new RankSystemRepository(),
          promotions: new PromotionRepository(),
          attendance: new AttendanceRepository(),
          grading: new GradingResultRepository(),
          completions: new CurriculumCompletionRepository(),
          members: new MemberRepository(),
        }),
    },
  ],
})
export class PromotionsModule {}
