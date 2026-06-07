import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { DuplicateBookingError, getTenantContextOrThrow } from '@obikai/db';
import { bookingCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { BookingsService } from './bookings.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * Bookings REST endpoints (scope §4.3): POST to book (capacity → 'booked' else 'waitlisted'),
 * DELETE to cancel (promotes the oldest waitlisted booking). Staff may act on anyone (RBAC resource
 * 'class'); a member may book/cancel themselves via self-access — both enforced in BookingsService.
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
  // A booking conflict (cancelled occurrence, already-booked member, or the unique-index race
  // surfacing as DuplicateBookingError) is a state conflict → 409, matching auth/billing.
  if (error instanceof ConflictError || error instanceof DuplicateBookingError)
    throw new ConflictException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

@Controller('bookings')
export class BookingsController {
  constructor(private readonly service: BookingsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), bookingCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async cancel(@Param('id') id: string) {
    try {
      await this.service.cancel(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }
}
