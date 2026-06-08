import { Controller, ForbiddenException, Get } from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { ForbiddenError, ReportingService } from './reporting.service.js';

/**
 * Reporting REST endpoints (scope §4.9). GET /reporting/dashboard returns the action-oriented owner
 * dashboard. Authorization is enforced in ReportingService via can() (member:list).
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  return {
    userId: ctx.userId ?? 'anonymous',
    roles: ctx.roles,
    ...(ctx.memberId !== null ? { memberId: ctx.memberId } : {}),
  };
}

@Controller('reporting')
export class ReportingController {
  constructor(private readonly service: ReportingService) {}

  @Get('dashboard')
  async dashboard() {
    try {
      return await this.service.ownerDashboard(currentActor(), new Date());
    } catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenException(error.message);
      throw error;
    }
  }
}
