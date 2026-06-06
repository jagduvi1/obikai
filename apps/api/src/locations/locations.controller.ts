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
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { locationCreateSchema, locationUpdateSchema } from '@obikai/domain';
import { z } from 'zod';
import { ForbiddenError, LocationsService, NotFoundError } from './locations.service.js';

/**
 * Locations REST endpoints (scope §4.10). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in LocationsService via can().
 * NOTE: until the auth slice lands, the context carries no verified roles, so these endpoints are
 * effectively locked down (deny-by-default) — exactly the safe failure mode we want.
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  // The tenancy middleware populated roles + memberId from the resolved-tenant Membership (ADR-0012).
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

@Controller('locations')
export class LocationsController {
  constructor(private readonly service: LocationsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), locationCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list() {
    try {
      return await this.service.list(currentActor());
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
      return await this.service.update(currentActor(), id, locationUpdateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }
}
