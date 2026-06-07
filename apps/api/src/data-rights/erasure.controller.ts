import {
  Controller,
  ForbiddenException,
  HttpCode,
  Ip,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { ForbiddenError, NotFoundError } from '../members/members.service.js';
import { ErasureService } from './erasure.service.js';

/**
 * Admin-initiated right-to-erasure (GDPR Art. 17). The dojo processes an erasure request for a member;
 * `POST /members/:id/erasure` is staff-only (`member:delete`, enforced in the service) and irreversible.
 * Returns the per-model erasure summary. (Member-facing self-service erasure can layer on this later.)
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  return {
    userId: ctx.userId ?? 'anonymous',
    roles: ctx.roles,
    ...(ctx.memberId !== null ? { memberId: ctx.memberId } : {}),
  };
}

@Controller('members')
export class ErasureController {
  constructor(private readonly erasure: ErasureService) {}

  @Post(':id/erasure')
  @HttpCode(200)
  async erase(@Param('id') id: string, @Ip() ip: string) {
    const ctx = getTenantContextOrThrow();
    try {
      return await this.erasure.eraseMember(currentActor(), ctx.tenantId, id, ip);
    } catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenException(error.message);
      if (error instanceof NotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }
}
