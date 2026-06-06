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
  UnauthorizedException,
} from '@nestjs/common';
import { EmailAlreadyRegisteredError } from '@obikai/adapter-auth-local';
import type { AppConfig } from '@obikai/config';
import { loginInputSchema, registerInputSchema } from '@obikai/domain';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG } from '../config.provider.js';
import { AuthService, InvalidCredentialsError } from './auth.service.js';
import type { IssuedTokens, SessionMeta } from './token.service.js';

/** httpOnly cookie name carrying the refresh token for browser clients. */
const REFRESH_COOKIE = 'obikai_rt';

/**
 * Auth endpoints (ADR-0012). Tenant-agnostic (identity is global), so these routes are excluded
 * from the tenancy middleware. The access token is returned in the body (Authorization: Bearer for
 * API clients); the refresh token is set as an httpOnly+SameSite cookie for browsers and may also be
 * sent in the body by native clients.
 */
@Controller('auth')
export class AuthController {
  readonly #secure: boolean;

  constructor(
    private readonly service: AuthService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    // Secure cookie everywhere except local dev. Derived from config, NOT per-request req.secure,
    // which is fragile behind a TLS-terminating proxy if trust-proxy is misconfigured (ADR-0012).
    this.#secure = config.baseDomain !== 'localhost' && config.baseDomain !== '127.0.0.1';
  }

  /** One source of truth for the refresh-cookie attributes, used by both set and clear. */
  #cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.#secure,
      sameSite: 'strict',
      path: '/',
      ...(expires ? { expires } : {}),
    };
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const input = registerInputSchema.parse(body);
      return this.respond(res, await this.service.register(input, metaOf(req)));
    } catch (error) {
      throw translate(error);
    }
  }

  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const input = loginInputSchema.parse(body);
      return this.respond(res, await this.service.login(input, metaOf(req)));
    } catch (error) {
      throw translate(error);
    }
  }

  @Post('refresh')
  async refresh(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = refreshFrom(req, body);
    if (!token) throw new UnauthorizedException('missing refresh token');
    try {
      return this.respond(res, await this.service.refresh(token, metaOf(req)));
    } catch (error) {
      throw translate(error);
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = refreshFrom(req, body);
    if (token) await this.service.logout(token);
    res.clearCookie(REFRESH_COOKIE, this.#cookieOptions());
  }

  /** Set the refresh cookie and return only the access token to the body. */
  private respond(
    res: Response,
    tokens: IssuedTokens,
  ): { accessToken: string; accessExpiresAt: string } {
    res.cookie(
      REFRESH_COOKIE,
      tokens.refreshToken,
      this.#cookieOptions(new Date(tokens.refreshExpiresAt)),
    );
    return { accessToken: tokens.accessToken, accessExpiresAt: tokens.accessExpiresAt };
  }
}

function metaOf(req: Request): SessionMeta {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua : null, ip: req.ip ?? null };
}

/** Refresh token from the httpOnly cookie (browsers) or the request body (native clients). */
function refreshFrom(req: Request, body: unknown): string | null {
  const fromCookie = parseCookie(req.headers.cookie, REFRESH_COOKIE);
  if (fromCookie) return fromCookie;
  const parsed = z.object({ refreshToken: z.string().min(1) }).safeParse(body);
  return parsed.success ? parsed.data.refreshToken : null;
}

/** Minimal cookie parse (avoids a cookie-parser dependency). */
function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function translate(error: unknown): Error {
  if (error instanceof InvalidCredentialsError) return new UnauthorizedException(error.message);
  if (error instanceof EmailAlreadyRegisteredError)
    return new ConflictException('email already registered');
  if (error instanceof z.ZodError) return new BadRequestException(error.issues);
  return error instanceof Error ? error : new Error(String(error));
}
