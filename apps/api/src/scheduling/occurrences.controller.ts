import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { z } from 'zod';
import { BookingsService } from './bookings.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * ClassOccurrences REST endpoints (scope §4.3): list by date range / location, read one, cancel
 * one, and read an occurrence's bookings (roster). Authorization enforced in the services via can()
 * (RBAC resource 'class').
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
  if (error instanceof ConflictError) throw new BadRequestException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const listQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  locationId: z.string().min(1).optional(),
  scheduleId: z.string().min(1).optional(),
});

@Controller('occurrences')
export class OccurrencesController {
  constructor(
    private readonly service: OccurrencesService,
    private readonly bookings: BookingsService,
  ) {}

  @Get()
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('locationId') locationId?: string,
    @Query('scheduleId') scheduleId?: string,
  ) {
    try {
      const opts = listQuerySchema.parse({ from, to, locationId, scheduleId });
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

  /** The roster (all bookings) for an occurrence. */
  @Get(':id/bookings')
  async bookingsForOccurrence(@Param('id') id: string) {
    try {
      return await this.bookings.listByOccurrence(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }

  /** Cancel a single occurrence (a per-occurrence override, §7). */
  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    try {
      return await this.service.cancel(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }
}
