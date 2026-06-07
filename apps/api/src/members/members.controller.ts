import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import {
  type MemberStatus,
  memberCreateSchema,
  memberStatusSchema,
  memberUpdateSchema,
} from '@obikai/domain';
import { z } from 'zod';
import { ForbiddenError, MembersService, NotFoundError } from './members.service.js';

/**
 * Members REST endpoints (scope §4.1). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in MembersService via can().
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

@Controller('members')
export class MembersController {
  constructor(private readonly service: MembersService) {}

  @Post()
  async create(@Body() body: unknown, @Ip() ip: string) {
    try {
      return await this.service.create(currentActor(), memberCreateSchema.parse(body), { ip });
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('status') status?: string) {
    try {
      const parsed: MemberStatus | undefined = status
        ? memberStatusSchema.parse(status)
        : undefined;
      return await this.service.list(currentActor(), parsed ? { status: parsed } : {});
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
  async update(@Param('id') id: string, @Body() body: unknown, @Ip() ip: string) {
    try {
      return await this.service.update(currentActor(), id, memberUpdateSchema.parse(body), { ip });
    } catch (error) {
      translate(error);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Ip() ip: string) {
    try {
      await this.service.remove(currentActor(), id, { ip });
    } catch (error) {
      translate(error);
    }
  }
}
