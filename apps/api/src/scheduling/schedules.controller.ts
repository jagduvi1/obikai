import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { classScheduleCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { OccurrencesService } from './occurrences.service.js';
import { SchedulesService } from './schedules.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * ClassSchedules REST endpoints (scope §4.3). Includes the materialize action — POST
 * /schedules/:id/materialize expands the schedule's RRULE over a horizon into ClassOccurrences.
 * Authorization enforced in the services via can() (RBAC resource 'class').
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
  if (error instanceof ConflictError) throw new ConflictException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

/** Partial update: every create field optional (domain exports only the create schema). */
const scheduleUpdateSchema = classScheduleCreateSchema.partial();

/** Materialize body: a horizon window. `to` is required; `from` defaults to now in the service. */
const materializeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime(),
});

@Controller('schedules')
export class SchedulesController {
  constructor(
    private readonly service: SchedulesService,
    private readonly occurrences: OccurrencesService,
  ) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), classScheduleCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('programId') programId?: string, @Query('locationId') locationId?: string) {
    try {
      const opts: { programId?: string; locationId?: string } = {};
      if (programId !== undefined) opts.programId = programId;
      if (locationId !== undefined) opts.locationId = locationId;
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
      return await this.service.update(currentActor(), id, scheduleUpdateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    try {
      await this.service.remove(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }

  /** Expand this schedule's RRULE over a horizon, materializing occurrences (idempotent). */
  @Post(':id/materialize')
  async materialize(@Param('id') id: string, @Body() body: unknown) {
    try {
      const { from, to } = materializeSchema.parse(body);
      return await this.occurrences.materialize(
        currentActor(),
        id,
        from !== undefined ? { from, to } : { to },
      );
    } catch (error) {
      translate(error);
    }
  }
}
