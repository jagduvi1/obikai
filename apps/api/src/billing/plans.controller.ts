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
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { planCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import {
  ForbiddenError,
  NotFoundError,
  type PlanUpdateInput,
  PlansService,
} from './plans.service.js';

/**
 * Plan REST endpoints (ADR-0013). The actor is derived from the request's TenantContext (opened by
 * TenancyMiddleware, ADR-0004); authorization is enforced in PlansService via can() against the
 * `membership` resource.
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

const planUpdateSchema = z
  .object({
    name: z.string().min(1),
    active: z.boolean(),
    vatRateId: z.string().min(1).nullable(),
    classPackCredits: z.number().int().positive().nullable(),
  })
  .partial();

@Controller('plans')
export class PlansController {
  constructor(private readonly service: PlansService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), planCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('active') active?: string) {
    try {
      const opts = active === undefined ? {} : { active: active === 'true' };
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
      const patch: PlanUpdateInput = planUpdateSchema.parse(body);
      return await this.service.update(currentActor(), id, patch);
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
