import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { getTenantContextOrThrow } from '@obikai/db';
import type { RoleAssignment } from '@obikai/domain';

/**
 * GET /me — the authenticated principal for the current request, projected from the TenantContext
 * (opened by TenancyMiddleware from the bearer token, ADR-0004). SPAs call this after login to learn
 * their own `memberId` so they can fetch their self-access data (eligibility, invoices, …). Pure
 * projection — no I/O. Anonymous requests (no valid token) get 401.
 */
export interface MeResponse {
  userId: string;
  memberId: string | null;
  roles: readonly RoleAssignment[];
}

@Controller('me')
export class MeController {
  @Get()
  me(): MeResponse {
    const ctx = getTenantContextOrThrow();
    if (!ctx.userId) throw new UnauthorizedException('not authenticated');
    return { userId: ctx.userId, memberId: ctx.memberId ?? null, roles: ctx.roles };
  }
}
