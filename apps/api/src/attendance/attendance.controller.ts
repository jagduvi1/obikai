import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { attendanceCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import {
  type AttendanceFilter,
  AttendanceService,
  ForbiddenError,
  NotFoundError,
} from './attendance.service.js';
import {
  CheckInClosedError,
  CheckInService,
  NotBookedError,
  OccurrenceCancelledError,
} from './check-in.service.js';

/**
 * Attendance & check-in REST endpoints (ADR-0014, scope §4.4). The actor is derived from the
 * request's TenantContext (opened by TenancyMiddleware, ADR-0004); authorization is enforced in
 * AttendanceService via can(). NOTE: until the auth slice lands, the context carries no verified
 * roles, so these endpoints are effectively locked down (deny-by-default) — the safe failure mode.
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  // The tenancy middleware populated roles + memberId from the resolved-tenant Membership (ADR-0012).
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
  // Self check-in state conflicts (cancelled class, outside the window, not booked) → 409.
  if (
    error instanceof OccurrenceCancelledError ||
    error instanceof CheckInClosedError ||
    error instanceof NotBookedError
  )
    throw new ConflictException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const checkInSchema = z.object({ occurrenceId: z.string().min(1) });

/** Query schema for the since-promotion count: member + discipline + an ISO `since` instant. */
const sincePromotionQuerySchema = z.object({
  memberId: z.string().min(1),
  disciplineId: z.string().min(1),
  since: z.string().datetime(),
});

@Controller('attendance')
export class AttendanceController {
  constructor(
    private readonly service: AttendanceService,
    private readonly checkIn: CheckInService,
  ) {}

  @Post()
  async record(@Body() body: unknown) {
    try {
      return await this.service.record(currentActor(), attendanceCreateSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }

  /**
   * Member SELF check-in (§4.4): record the logged-in member's attendance for a class they booked and
   * that is happening now. 409 if the class is cancelled, outside the check-in window, or unbooked.
   */
  @Post('checkin')
  async selfCheckIn(@Body() body: unknown) {
    try {
      const { occurrenceId } = checkInSchema.parse(body);
      return await this.checkIn.selfCheckIn(currentActor(), occurrenceId);
    } catch (error) {
      translate(error);
    }
  }

  @Get('since-promotion')
  async sincePromotion(
    @Query('memberId') memberId?: string,
    @Query('disciplineId') disciplineId?: string,
    @Query('since') since?: string,
  ) {
    try {
      const parsed = sincePromotionQuerySchema.parse({ memberId, disciplineId, since });
      const count = await this.service.classesSinceLastPromotion(
        currentActor(),
        parsed.memberId,
        parsed.disciplineId,
        new Date(parsed.since),
      );
      return { count };
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('memberId') memberId?: string, @Query('disciplineId') disciplineId?: string) {
    try {
      const filter: AttendanceFilter = {};
      if (memberId) filter.memberId = memberId;
      if (disciplineId) filter.disciplineId = disciplineId;
      return await this.service.list(currentActor(), filter);
    } catch (error) {
      translate(error);
    }
  }
}
