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
import { programCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { ProgramsService } from './programs.service.js';
import { ConflictError, ForbiddenError, NotFoundError } from './scheduling.errors.js';

/**
 * Programs REST endpoints (scope §4.3). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in ProgramsService via can()
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
  if (error instanceof ConflictError) throw new ConflictException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

/** Partial update: every create field optional (domain exports only the create schema). */
const programUpdateSchema = programCreateSchema.partial();

@Controller('programs')
export class ProgramsController {
  constructor(private readonly service: ProgramsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), programCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('active') active?: string) {
    try {
      const parsed = active === undefined ? {} : { active: active === 'true' };
      return await this.service.list(currentActor(), parsed);
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
      return await this.service.update(currentActor(), id, programUpdateSchema.parse(body));
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
}
