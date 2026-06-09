import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import { getTenantContextOrThrow } from '@obikai/db';
import { waiverSignSchema, waiverTemplateCreateSchema } from '@obikai/domain';
import type { Request } from 'express';
import { z } from 'zod';
import { ForbiddenError, NotFoundError, WaiversService } from './waivers.service.js';

/**
 * Waivers REST endpoints (ADR-0014, scope §4.10). The actor is derived from the request's
 * TenantContext (opened by TenancyMiddleware, ADR-0004); authorization is enforced in
 * WaiversService via can(). Until the auth slice lands, the context carries no verified roles, so
 * these endpoints are deny-by-default — the safe failure mode.
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
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

// Editing a template mints a new version (ADR-0014); every body field is optional on a PATCH.
const waiverTemplateUpdateSchema = waiverTemplateCreateSchema.partial();

// `active` arrives as a query string; coerce the usual truthy/falsy spellings, else leave undefined.
const activeQuerySchema = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

// Sign accepts the domain fields plus an OPTIONAL key of a previously-uploaded document.
const signBodySchema = waiverSignSchema.extend({
  documentStorageKey: z.string().min(1).optional(),
});

// Request a presigned upload URL for a waiver document before signing.
const documentUploadSchema = z.object({
  contentType: z.string().min(1).max(255),
  ext: z.string().max(8).optional(),
});

@Controller('waivers')
export class WaiversController {
  constructor(private readonly service: WaiversService) {}

  @Post('templates')
  async createTemplate(@Body() body: unknown) {
    try {
      return await this.service.createTemplate(
        currentActor(),
        waiverTemplateCreateSchema.parse(body),
      );
    } catch (error) {
      translate(error);
    }
  }

  @Get('templates')
  async listTemplates(@Query('active') active?: string) {
    try {
      const parsed = activeQuerySchema.parse(active);
      return await this.service.listTemplates(
        currentActor(),
        parsed === undefined ? {} : { active: parsed },
      );
    } catch (error) {
      translate(error);
    }
  }

  @Get('templates/:id')
  async getTemplate(@Param('id') id: string) {
    try {
      return await this.service.getTemplate(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }

  @Patch('templates/:id')
  async updateTemplate(@Param('id') id: string, @Body() body: unknown) {
    try {
      return await this.service.updateTemplate(
        currentActor(),
        id,
        waiverTemplateUpdateSchema.parse(body),
      );
    } catch (error) {
      translate(error);
    }
  }

  @Post('sign')
  async sign(@Req() req: Request, @Body() body: unknown) {
    try {
      const { documentStorageKey, ...input } = signBodySchema.parse(body);
      const ctx = getTenantContextOrThrow();
      return await this.service.sign(currentActor(), input, {
        ip: req.ip ?? null,
        tenantId: ctx.tenantId,
        ...(documentStorageKey !== undefined ? { documentStorageKey } : {}),
      });
    } catch (error) {
      translate(error);
    }
  }

  /** Allocate a presigned PUT URL for a waiver document; upload to it, then `sign` with the key. */
  @Post('documents/upload-url')
  async createDocumentUploadUrl(@Body() body: unknown) {
    try {
      const input = documentUploadSchema.parse(body);
      const ctx = getTenantContextOrThrow();
      return await this.service.createDocumentUploadUrl(currentActor(), ctx.tenantId, {
        contentType: input.contentType,
        ext: input.ext ?? '',
      });
    } catch (error) {
      translate(error);
    }
  }

  /** Presigned GET URL for a signature's stored document (self / guardian / staff). */
  @Get('signatures/:id/document-url')
  async getDocumentUrl(@Param('id') id: string) {
    try {
      return await this.service.getDocumentDownloadUrl(currentActor(), id);
    } catch (error) {
      translate(error);
    }
  }

  @Get('signatures')
  async listSignatures(@Query('memberId') memberId?: string) {
    try {
      const parsed = z.string().min(1).parse(memberId);
      return await this.service.listSignatures(currentActor(), parsed);
    } catch (error) {
      translate(error);
    }
  }

  /**
   * Member-portal view: each active template + whether `memberId` has signed its current version.
   * Self-accessible (the covered member / their guardian) so a member can see what to sign without
   * the staff `waiver:list` grant.
   */
  @Get('status')
  async listForMember(@Query('memberId') memberId?: string) {
    try {
      const parsed = z.string().min(1).parse(memberId);
      return await this.service.listForMember(currentActor(), parsed);
    } catch (error) {
      translate(error);
    }
  }
}
