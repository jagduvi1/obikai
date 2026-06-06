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
  Res,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import {
  BillingError,
  ForbiddenError as BillingForbiddenError,
  NotFoundError as BillingNotFoundError,
  BillingService,
} from '@obikai/billing';
import { BillingProfileRepository, MemberRepository, getTenantContextOrThrow } from '@obikai/db';
import { type InvoiceStatus } from '@obikai/domain';
import type { Response } from 'express';
import { z } from 'zod';
import { renderInvoicePdf } from './invoice-pdf.js';
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
    private readonly billingProfiles: BillingProfileRepository,
    private readonly members: MemberRepository,
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

  /**
   * Stream a compliant invoice PDF (ADR-0013/0018). Authorization + fetch reuse `service.get`
   * (members may download their OWN invoices via self-access); the seller block comes from the
   * tenant billing profile and the buyer name from the linked member. Uses @Res to stream raw bytes.
   */
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    try {
      const actor = currentActor();
      const invoice = await this.service.get(actor, id);
      const [seller, member] = await Promise.all([
        this.billingProfiles.get(),
        this.members.findById(invoice.memberId),
      ]);
      const buyerName = member ? `${member.firstName} ${member.lastName}` : null;
      const bytes = await renderInvoicePdf({ invoice, seller, buyerName });
      const filename = `${invoice.number ?? invoice.id}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.end(Buffer.from(bytes));
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
