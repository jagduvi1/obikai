import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { AppConfig } from '@obikai/config';
import { memberInviteAcceptSchema } from '@obikai/domain';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG } from '../config.provider.js';
import {
  InvalidInviteTokenError,
  InviteEmailTakenError,
  MemberInviteService,
} from './member-invite.service.js';

/** httpOnly cookie carrying the refresh token (same name/handling as the auth plane). */
const REFRESH_COOKIE = 'obikai_rt';

/**
 * Public invite-accept endpoint (member onboarding). Tenant-agnostic — the tenant is resolved from the
 * trusted token, not the request — so this route is EXCLUDED from TenancyMiddleware (tenancy.module.ts).
 * On success the new member is auto-logged-in: access token in the body, refresh token as the httpOnly
 * cookie (mirroring AuthController).
 */
@Controller('invites')
export class InvitesController {
  readonly #secure: boolean;

  constructor(
    private readonly invites: MemberInviteService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#secure = config.baseDomain !== 'localhost' && config.baseDomain !== '127.0.0.1';
  }

  @Post('accept')
  @HttpCode(200)
  async accept(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { token, password } = memberInviteAcceptSchema.parse(body);
      const ua = req.headers['user-agent'];
      const tokens = await this.invites.acceptInvite(token, password, {
        userAgent: typeof ua === 'string' ? ua : null,
        ip: req.ip ?? null,
      });
      const cookieOptions: CookieOptions = {
        httpOnly: true,
        secure: this.#secure,
        sameSite: 'strict',
        path: '/',
        expires: new Date(tokens.refreshExpiresAt),
      };
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, cookieOptions);
      return { accessToken: tokens.accessToken, accessExpiresAt: tokens.accessExpiresAt };
    } catch (error) {
      if (error instanceof InvalidInviteTokenError)
        throw new BadRequestException('invalid or expired invite');
      if (error instanceof InviteEmailTakenError)
        throw new ConflictException('an account already exists for this email');
      if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
      throw error;
    }
  }
}
