import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { z } from 'zod';
import {
  ForbiddenError,
  NotFoundError,
  PromotionRefusedError,
  PromotionsService,
} from './promotions.service.js';

/**
 * Promotion REST endpoints (ADR-0005/0015): the eligibility dashboard, the human award action, and
 * immutable history. Authorization is enforced in PromotionsService via can() against the
 * `promotion` resource (members reach their OWN data through self-access).
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  return {
    userId: ctx.userId ?? 'anonymous',
    roles: ctx.roles,
    ...(ctx.memberId !== null ? { memberId: ctx.memberId } : {}),

    ...(ctx.guardianships ? { guardianships: ctx.guardianships } : {}),
  };
}

function translate(error: unknown): never {
  if (error instanceof ForbiddenError) throw new ForbiddenException(error.message);
  if (error instanceof NotFoundError) throw new NotFoundException(error.message);
  if (error instanceof PromotionRefusedError)
    throw new UnprocessableEntityException({ reason: error.reason, unmet: error.unmet });
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const awardSchema = z.object({
  memberId: z.string().min(1),
  disciplineId: z.string().min(1),
  toStepId: z.string().min(1),
  overrideReason: z.string().min(1).optional(),
});

const refMemberDiscipline = z.object({
  memberId: z.string().min(1),
  disciplineId: z.string().min(1),
});

@Controller('promotions')
export class PromotionsController {
  constructor(private readonly service: PromotionsService) {}

  /** Eligibility dashboard: GET /promotions/eligibility?memberId&disciplineId. */
  @Get('eligibility')
  async eligibility(
    @Query('memberId') memberId?: string,
    @Query('disciplineId') disciplineId?: string,
  ) {
    try {
      const q = refMemberDiscipline.parse({ memberId, disciplineId });
      return await this.service.eligibility(currentActor(), q.memberId, q.disciplineId);
    } catch (error) {
      translate(error);
    }
  }

  /** Award a promotion (human-in-the-loop). */
  @Post()
  async award(@Body() body: unknown) {
    try {
      return await this.service.award(currentActor(), awardSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  /** History: GET /promotions?memberId[&disciplineId]. */
  @Get()
  async history(
    @Query('memberId') memberId?: string,
    @Query('disciplineId') disciplineId?: string,
  ) {
    try {
      const member = z.string().min(1).parse(memberId);
      return await this.service.history(currentActor(), member, disciplineId || undefined);
    } catch (error) {
      translate(error);
    }
  }
}
