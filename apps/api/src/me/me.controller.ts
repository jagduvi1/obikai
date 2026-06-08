import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { type RoleAssignment, memberProfileUpdateSchema } from '@obikai/domain';
import { z } from 'zod';
import { ForbiddenError, MembersService, NotFoundError } from '../members/members.service.js';

/**
 * GET /me — the authenticated principal for the current request, projected from the TenantContext
 * (opened by TenancyMiddleware from the bearer token, ADR-0004). SPAs call this after login to learn
 * their own `memberId` so they can fetch their self-access data (eligibility, invoices, …).
 *
 * GET/PATCH /me/profile — member-app profile self-service. PATCH is restricted to the safe
 * `memberProfileUpdateSchema` fields (contact + emergency contact) and always targets the actor's OWN
 * member record, so a member cannot edit anyone else nor self-set staff-managed fields (status/tags).
 */
export interface MeResponse {
  userId: string;
  memberId: string | null;
  roles: readonly RoleAssignment[];
}

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

@Controller('me')
export class MeController {
  constructor(private readonly members: MembersService) {}

  @Get()
  me(): MeResponse {
    const ctx = getTenantContextOrThrow();
    if (!ctx.userId) throw new UnauthorizedException('not authenticated');
    return { userId: ctx.userId, memberId: ctx.memberId ?? null, roles: ctx.roles };
  }

  @Get('profile')
  async profile() {
    try {
      return await this.members.getOwnProfile(currentActor());
    } catch (error) {
      translate(error);
    }
  }

  @Patch('profile')
  async updateProfile(@Body() body: unknown) {
    try {
      return await this.members.updateOwnProfile(
        currentActor(),
        memberProfileUpdateSchema.parse(body),
      );
    } catch (error) {
      translate(error);
    }
  }
}
