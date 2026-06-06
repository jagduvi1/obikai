import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { type InvoiceStatus } from '@obikai/domain';
import { z } from 'zod';
import {
  BillingError,
  ForbiddenError as BillingForbiddenError,
  NotFoundError as BillingNotFoundError,
  BillingService,
} from './billing.service.js';
import { ForbiddenError, InvoicesService, NotFoundError } from './invoices.service.js';

/**
 * Invoice REST endpoints (ADR-0013). The actor is derived from the request's TenantContext (opened
 * by TenancyMiddleware, ADR-0004). Reads are served by InvoicesService; POST /invoices/:id/issue
 * delegates to the framework-free BillingService to allocate the gapless number and open the
 * invoice. Authorization is enforced in the services via can() against the `invoice` resource.
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
  if (error instanceof ForbiddenError || error instanceof BillingForbiddenError)
    throw new ForbiddenException(error.message);
  if (error instanceof NotFoundError || error instanceof BillingNotFoundError)
    throw new NotFoundException(error.message);
  if (error instanceof BillingError) throw new ConflictException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

const invoiceStatusSchema = z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']);

@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly service: InvoicesService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  async list(@Query('memberId') memberId?: string, @Query('status') status?: string) {
    try {
      const parsedStatus: InvoiceStatus | undefined = status
        ? invoiceStatusSchema.parse(status)
        : undefined;
      const opts: { memberId?: string; status?: InvoiceStatus } = {};
      if (memberId) opts.memberId = memberId;
      if (parsedStatus) opts.status = parsedStatus;
      return await this.service.list(currentActor(), opts);
    } catch (error) {
      translate(error);
    }
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    try {
      return await this.service.get(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }

  @Post(':id/issue')
  @HttpCode(200)
  async issue(@Param('id') id: string) {
    try {
      return await this.billing.issue(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }
}
