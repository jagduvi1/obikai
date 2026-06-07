import { BadRequestException, Body, Controller, ForbiddenException, Post } from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { z } from 'zod';
import { ForbiddenError, VatValidationService } from './vat-validation.service.js';

/**
 * VAT validation endpoint (ADR-0025). Validates a VAT id's format offline and, when well-formed,
 * its registration via the configured provider (VIES/none). Authorization is enforced in the service
 * via can('tenantSettings'). The actor comes from the request's TenantContext (ADR-0004).
 */
function currentActor(): AuthzActor {
  const ctx = getTenantContextOrThrow();
  return {
    userId: ctx.userId ?? 'anonymous',
    roles: ctx.roles,
    ...(ctx.memberId !== null ? { memberId: ctx.memberId } : {}),
  };
}

const validateSchema = z.object({ vatId: z.string().min(1).max(20) });

@Controller('billing/vat')
export class VatController {
  constructor(private readonly service: VatValidationService) {}

  @Post('validate')
  async validate(@Body() body: unknown) {
    try {
      const { vatId } = validateSchema.parse(body);
      return await this.service.validate(currentActor(), vatId);
    } catch (error) {
      if (error instanceof ForbiddenError) throw new ForbiddenException(error.message);
      if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
      throw error;
    }
  }
}
