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
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { vatRateCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, VatRatesService } from './vat-rates.service.js';

/**
 * VAT rate REST endpoints (ADR-0013). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in VatRatesService via can()
 * against the `tenantSettings` resource (owner-only by default).
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

const vatRateUpdateSchema = z
  .object({ name: z.string().min(1), percent: z.number().min(0).max(100) })
  .partial();

@Controller('vat-rates')
export class VatRatesController {
  constructor(private readonly service: VatRatesService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.service.create(currentActor(), vatRateCreateSchema.parse(body));
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
      return await this.service.update(currentActor(), id, vatRateUpdateSchema.parse(body));
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
