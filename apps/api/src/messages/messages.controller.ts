import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Ip,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { broadcastCreateSchema } from '@obikai/domain';
import { z } from 'zod';
import { BroadcastService, ForbiddenError, TooManyRecipientsError } from './broadcast.service.js';

/**
 * Messaging REST endpoints (scope §4.8): POST /messages broadcasts to a segment; GET /messages/:id is
 * the delivery report; GET /messages?memberId is a member's history. Authorization is enforced in
 * BroadcastService via can() (announcement resource); self-access lets a member read their own history.
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
  // The synchronous-broadcast recipient cap is a precondition failure → 422 (not a 400 bad-request).
  if (error instanceof TooManyRecipientsError)
    throw new UnprocessableEntityException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

@Controller('messages')
export class MessagesController {
  constructor(private readonly service: BroadcastService) {}

  @Post()
  async broadcast(@Body() body: unknown, @Ip() ip: string) {
    try {
      return await this.service.broadcast(currentActor(), broadcastCreateSchema.parse(body), {
        ip,
      });
    } catch (error) {
      translate(error);
    }
  }

  @Get(':broadcastId')
  async report(@Param('broadcastId') broadcastId: string) {
    try {
      return await this.service.deliveryReport(currentActor(), broadcastId);
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async memberHistory(@Query('memberId') memberId?: string) {
    try {
      if (!memberId) throw new BadRequestException('memberId is required');
      return await this.service.memberHistory(currentActor(), memberId);
    } catch (error) {
      translate(error);
    }
  }
}
