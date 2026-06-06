import {
  BadRequestException,
  Body,
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
import { enrollmentCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { EnrollmentsService, ForbiddenError, NotFoundError } from './enrollments.service.js';

/**
 * Enrollment REST endpoints (ADR-0013). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in EnrollmentsService via
 * can() against the `membership` resource.
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

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const freezeSchema = z
  .object({ freezeFrom: isoDate.nullable(), freezeUntil: isoDate.nullable() })
  .partial();
const cancelSchema = z.object({ cancelAt: isoDate.nullable() }).partial();

@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly service: EnrollmentsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), enrollmentCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('memberId') memberId?: string) {
    try {
      return await this.service.list(currentActor(), memberId ? { memberId } : {});
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

  @Post(':id/freeze')
  async freeze(@Param('id') id: string, @Body() body: unknown) {
    try {
      const window = freezeSchema.parse(body ?? {});
      return await this.service.freeze(currentActor(), id, window);
    } catch (error) {
      translate(error);
    }
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Body() body: unknown) {
    try {
      const parsed = cancelSchema.parse(body ?? {});
      return await this.service.cancel(currentActor(), id, parsed.cancelAt ?? null);
    } catch (error) {
      translate(error);
    }
  }
}
