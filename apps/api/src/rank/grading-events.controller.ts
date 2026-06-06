import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { gradingEventCreateSchema, gradingResultCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import {
  ForbiddenError,
  type GradingEventUpdateInput,
  GradingEventsService,
  NotFoundError,
} from './grading-events.service.js';

/**
 * Grading-event REST endpoints (ADR-0015). Authorization is enforced in GradingEventsService via
 * can() against the `gradingEvent` resource (instructor/owner).
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  return {
    userId: ctx.userId ?? 'anonymous',
    roles: ctx.roles,
    ...(ctx.memberId !== null ? { memberId: ctx.memberId } : {}),
  };
}

function translate(error: unknown): never {
  if (error instanceof ForbiddenError) throw new ForbiddenException(error.message);
  if (error instanceof NotFoundError) throw new NotFoundException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const updateSchema = z
  .object({
    name: z.string().min(1),
    scheduledAt: z.string().datetime(),
    locationId: z.string().min(1).nullable(),
    status: z.enum(['scheduled', 'completed', 'cancelled']),
  })
  .partial();

@Controller('grading-events')
export class GradingEventsController {
  constructor(private readonly service: GradingEventsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), gradingEventCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('disciplineId') disciplineId?: string) {
    try {
      const opts = disciplineId ? { disciplineId } : {};
      return await this.service.list(currentActor(), opts);
    } catch (error) {
      translate(error);
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    try {
      return await this.service.get(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    try {
      const patch: GradingEventUpdateInput = updateSchema.parse(body);
      return await this.service.update(currentActor(), id, patch);
    } catch (error) {
      translate(error);
    }
  }

  @Post(':id/results')
  async recordResult(@Param('id') id: string, @Body() body: unknown) {
    try {
      return await this.service.recordResult(
        currentActor(),
        id,
        gradingResultCreateSchema.parse(body),
      );
    } catch (error) {
      translate(error);
    }
  }

  @Get(':id/results')
  async listResults(@Param('id') id: string) {
    try {
      return await this.service.listResults(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }
}
