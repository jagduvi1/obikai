import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { getTenantContextOrThrow } from '@obikai/db';
import { z } from 'zod';
import { ConsentService, type ConsentSubject } from './consent.service.js';

/**
 * Self-service consent endpoints under `/me/consent` (GDPR Art. 6(1)(a)/7, audit H8). The SUBJECT is
 * always the authenticated user — there is no path here to grant/withdraw on another person's behalf,
 * so a member can only manage their OWN consent. `lawfulBasis` is fixed to `consent` server-side (a
 * client cannot claim a different basis). Anonymous requests get 401.
 */
const grantSchema = z
  .object({
    purpose: z.string().min(1).max(100),
    policyVersion: z.string().min(1).max(100),
    note: z.string().max(1000).optional(),
  })
  .strict();

@Controller('me/consent')
export class ConsentController {
  constructor(private readonly service: ConsentService) {}

  /** The data subject = the authenticated user; tenant from the request context. */
  private subject(): ConsentSubject {
    const ctx = getTenantContextOrThrow();
    if (!ctx.userId) throw new UnauthorizedException('not authenticated');
    return { tenantId: ctx.tenantId, subjectId: ctx.userId };
  }

  /** The caller's own consent history (current state per purpose = the latest record). */
  @Get()
  async list() {
    return this.service.list(this.subject());
  }

  /** Grant consent for a purpose. Source IP + user-agent are captured as Art. 7(1) evidence. */
  @Post()
  @HttpCode(204)
  async grant(@Body() body: unknown, @Ip() ip: string, @Headers('user-agent') userAgent?: string) {
    let input: z.infer<typeof grantSchema>;
    try {
      input = grantSchema.parse(body);
    } catch (error) {
      if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
      throw error;
    }
    await this.service.grant(this.subject(), {
      ...input,
      ip,
      ...(userAgent !== undefined ? { userAgent } : {}),
    });
  }

  /** Withdraw consent for a purpose. Idempotent: 204 whether or not an active grant existed. */
  @Delete(':purpose')
  @HttpCode(204)
  async withdraw(@Param('purpose') purpose: string, @Ip() ip: string) {
    await this.service.withdraw(this.subject(), purpose, ip);
  }
}
