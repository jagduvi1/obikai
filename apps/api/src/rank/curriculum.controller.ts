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
import { curriculumItemCreateSchema, localizedStringSchema } from '@obikai/domain';
import { z } from 'zod';
import {
  type CurriculumItemUpdateInput,
  CurriculumService,
  ForbiddenError,
  NotFoundError,
} from './curriculum.service.js';

/**
 * Curriculum REST endpoints (ADR-0015): authoring items + tracking per-student completion.
 * Authorization is enforced in CurriculumService via can() against the `curriculum` resource
 * (members reach their OWN completions through self-access).
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  return {
    userId: ctx.userId ?? 'anonymous',
    roles: ctx.roles,
    ...(ctx.memberId !== null ? { memberId: ctx.memberId } : {}),

    ...(ctx.guardianships ? { guardianships: ctx.guardianships } : {}),
  };
}

function translate(error: unknown): never {
  if (error instanceof ForbiddenError) throw new ForbiddenException(error.message);
  if (error instanceof NotFoundError) throw new NotFoundException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const itemUpdateSchema = z
  .object({
    label: localizedStringSchema,
    description: localizedStringSchema.nullable(),
    mediaRef: z.string().min(1).nullable(),
  })
  .partial();

const completionSchema = z.object({
  memberId: z.string().min(1),
  disciplineId: z.string().min(1),
  itemKey: z.string().min(1),
});

const completionQuerySchema = z.object({
  memberId: z.string().min(1),
  disciplineId: z.string().min(1),
});

@Controller('curriculum')
export class CurriculumController {
  constructor(private readonly service: CurriculumService) {}

  @Post('items')
  async createItem(@Body() body: unknown) {
    try {
      return await this.service.createItem(currentActor(), curriculumItemCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get('items')
  async listItems(@Query('disciplineId') disciplineId?: string) {
    try {
      const opts = disciplineId ? { disciplineId } : {};
      return await this.service.listItems(currentActor(), opts);
    } catch (error) {
      translate(error);
    }
  }

  @Patch('items/:id')
  async updateItem(@Param('id') id: string, @Body() body: unknown) {
    try {
      const patch: CurriculumItemUpdateInput = itemUpdateSchema.parse(body);
      return await this.service.updateItem(currentActor(), id, patch);
    } catch (error) {
      translate(error);
    }
  }

  @Post('completions')
  async markComplete(@Body() body: unknown) {
    try {
      return await this.service.markComplete(currentActor(), completionSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Delete('completions')
  @HttpCode(204)
  async unmarkComplete(@Body() body: unknown) {
    try {
      await this.service.unmarkComplete(currentActor(), completionSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  @Get('completions')
  async listCompletions(
    @Query('memberId') memberId?: string,
    @Query('disciplineId') disciplineId?: string,
  ) {
    try {
      const q = completionQuerySchema.parse({ memberId, disciplineId });
      return await this.service.listCompletions(currentActor(), q.memberId, q.disciplineId);
    } catch (error) {
      translate(error);
    }
  }
}
