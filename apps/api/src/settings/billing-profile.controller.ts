import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { billingProfileInputSchema } from '@obikai/domain';
import { z } from 'zod';
import { BillingProfileService, ForbiddenError } from './billing-profile.service.js';

/**
 * Seller billing profile REST endpoints (ADR-0018). The actor comes from the request's
 * TenantContext (ADR-0004/0012); authorization is enforced in the service via can('tenantSettings').
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
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

@Controller('settings/billing-profile')
export class BillingProfileController {
  constructor(private readonly service: BillingProfileService) {}

  /** The current tenant's seller profile, or null if not configured yet. */
  @Get()
  async get() {
    try {
      return await this.service.get(currentActor());
    } catch (error) {
      translate(error);
    }
  }

  /** Create-or-replace the seller profile (owner only). */
  @Put()
  async put(@Body() body: unknown) {
    try {
      return await this.service.upsert(currentActor(), billingProfileInputSchema.parse(body));
    } catch (error) {
      translate(error);
    }
  }
}
