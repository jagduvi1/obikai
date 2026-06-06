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
import { z } from 'zod';
import {
  ForbiddenError,
  NotFoundError,
  RankSystemsService,
  ValidationFailedError,
} from './rank-systems.service.js';

/**
 * Rank-system REST endpoints (ADR-0005/0015). Authoring (validate/publish) is gated on the
 * `rankSystem` resource in the service; the config body is validated by the pure engine, not here.
 * A failed validation returns 400 with the engine's i18n-keyed issues.
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
  if (error instanceof ValidationFailedError) throw new BadRequestException(error.issues);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

@Controller('rank-systems')
export class RankSystemsController {
  constructor(private readonly service: RankSystemsService) {}

  /** Dry-run: validate a config without persisting. Returns { valid, draft|errors }. */
  @Post('validate')
  async validate(@Body() body: unknown) {
    try {
      return await this.service.validate(currentActor(), body);
    } catch (error) {
      translate(error);
    }
  }

  /** Validate + mint + persist a new immutable version. */
  @Post()
  async publish(@Body() body: unknown) {
    try {
      return await this.service.publish(currentActor(), body);
    } catch (error) {
      translate(error);
    }
  }

  @Get('by-discipline/:disciplineId')
  async byDiscipline(@Param('disciplineId') disciplineId: string) {
    try {
      return await this.service.getSystemByDiscipline(currentActor(), disciplineId);
    } catch (error) {
      translate(error);
    }
  }

  @Get(':systemId/versions')
  async listVersions(@Param('systemId') systemId: string) {
    try {
      return await this.service.listVersions(currentActor(), systemId);
    } catch (error) {
      translate(error);
    }
  }

  @Get(':systemId/current')
  async current(@Param('systemId') systemId: string) {
    try {
      return await this.service.getCurrentVersion(currentActor(), systemId);
    } catch (error) {
      translate(error);
    }
  }

  @Get('versions/:versionId')
  async version(@Param('versionId') versionId: string) {
    try {
      return await this.service.getVersion(currentActor(), versionId);
    } catch (error) {
      translate(error);
    }
  }
}
