import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { householdCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { ForbiddenError, HouseholdsService, NotFoundError } from './households.service.js';

/**
 * Households REST endpoints (scope §4.1). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in HouseholdsService via can()
 * on the `member` resource. NOTE: until the auth slice lands, the context carries no verified roles,
 * so these endpoints are effectively locked down (deny-by-default) — the safe failure mode.
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

@Controller('households')
export class HouseholdsController {
  constructor(private readonly service: HouseholdsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), householdCreateSchema.parse(body));
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

  @Post(':id/members/:memberId')
  async linkMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    try {
      return await this.service.linkMember(currentActor(), id, memberId);
    } catch (error) {
      translate(error);
    }
  }

  @Delete(':id/members/:memberId')
  @HttpCode(204)
  async unlinkMember(@Param('id') id: string, @Param('memberId') memberId: string) {
    try {
      await this.service.unlinkMember(currentActor(), id, memberId);
    } catch (error) {
      translate(error);
    }
  }
}
