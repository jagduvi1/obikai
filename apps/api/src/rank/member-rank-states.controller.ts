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
  MemberRankStatesService,
  NotFoundError,
  RankEnrollmentError,
} from './member-rank-states.service.js';

/**
 * Member rank-state (enrollment) endpoints (ADR-0015): enroll a member into a discipline and read
 * their positions. Authorization is enforced in the service via can() against `promotion` (members
 * read their OWN via self-access).
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
  if (error instanceof RankEnrollmentError) throw new UnprocessableEntityException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const enrollSchema = z.object({
  memberId: z.string().min(1),
  disciplineId: z.string().min(1),
});

@Controller('rank-states')
export class MemberRankStatesController {
  constructor(private readonly service: MemberRankStatesService) {}

  @Post()
  async enroll(@Body() body: unknown) {
    try {
      return await this.service.enroll(currentActor(), enrollSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('memberId') memberId?: string) {
    try {
      const member = z.string().min(1).parse(memberId);
      return await this.service.list(currentActor(), member);
    } catch (error) {
      translate(error);
    }
  }
}
