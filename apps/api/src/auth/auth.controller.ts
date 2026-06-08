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
import {
  DEFAULT_LOCALE,
  loginInputSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerInputSchema,
} from '@obikai/domain';
import { NotificationsService } from '@obikai/notifications';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { APP_CONFIG } from '../config.provider.js';
import { AuthService, InvalidCredentialsError, InvalidResetTokenError } from './auth.service.js';
import { type IssuedTokens, type SessionMeta, TokenService } from './token.service.js';

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
  readonly #appName: string;
  readonly #appPublicUrl: string | null;

  constructor(
    private readonly service: AuthService,
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokenService,
  ) {
    // Secure cookie everywhere except local dev. Derived from config, NOT per-request req.secure,
    // which is fragile behind a TLS-terminating proxy if trust-proxy is misconfigured (ADR-0012).
    this.#secure = config.baseDomain !== 'localhost' && config.baseDomain !== '127.0.0.1';
    this.#appName = config.appName;
    this.#appPublicUrl = config.appPublicUrl;
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

  /**
   * Begin a password reset. ALWAYS returns 204, whether or not the email is registered, so the
   * endpoint is not an account-enumeration oracle. When the account exists, a reset email is sent
   * best-effort (a mail failure is swallowed — it must not change the response or 500 the caller).
   */
  @Post('password-reset/request')
  @HttpCode(204)
  async requestPasswordReset(@Body() body: unknown): Promise<void> {
    let email: string;
    try {
      ({ email } = passwordResetRequestSchema.parse(body));
    } catch (error) {
      throw translate(error);
    }
    const request = await this.service.requestPasswordReset(email);
    if (!request) return; // unknown account — identical 204, no email
    const resetUrl =
      this.#appPublicUrl !== null
        ? `${this.#appPublicUrl}/reset-password?token=${encodeURIComponent(request.token)}`
        : null;
    const expiresInHours = Math.max(
      1,
      Math.round((new Date(request.expiresAt).getTime() - Date.now()) / 3_600_000),
    );
    try {
      await this.notifications.sendPasswordReset(
        { email: request.email },
        DEFAULT_LOCALE,
        { resetUrl, token: request.token, expiresInHours },
        { name: request.email, dojoName: this.#appName, tenantDefaultLocale: DEFAULT_LOCALE },
      );
    } catch {
      // Swallow: delivery problems must not reveal account existence nor fail the request. The
      // adapter logs its own errors; the user can simply request another link.
    }
  }

  /** Complete a password reset with the emailed token + new password. Generic 400 on a bad/expired
   *  token (no oracle for which it was). On success the user's sessions are all revoked (in the service). */
  @Post('password-reset/confirm')
  @HttpCode(204)
  async confirmPasswordReset(@Body() body: unknown): Promise<void> {
    try {
      const { token, password } = passwordResetConfirmSchema.parse(body);
      await this.service.confirmPasswordReset(token, password);
    } catch (error) {
      throw translate(error);
    }
  }

  /**
   * Change the password of the authenticated account (E3). Authenticated by the access token directly
   * (the /auth plane is outside the tenancy middleware), so we verify the Bearer here. The current
   * password must be proven — a stolen access token alone cannot change it. On success every refresh
   * session is revoked and a fresh one is issued for this device, so the response carries new tokens
   * (other devices can no longer mint access tokens; their current ones expire within the short TTL).
   */
  @Post('password')
  @HttpCode(200)
  async changePassword(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bearer = bearerFrom(req);
    if (!bearer) throw new UnauthorizedException('missing access token');
    const claims = await this.tokens.verifyAccess(bearer);
    if (!claims) throw new UnauthorizedException('invalid access token');
    try {
      const { currentPassword, newPassword } = passwordChangeSchema.parse(body);
      const tokens = await this.service.changePassword(
        claims.userId,
        currentPassword,
        newPassword,
        metaOf(req),
      );
      return this.respond(res, tokens);
    } catch (error) {
      throw translate(error);
    }
  }

  /**
   * Set the refresh cookie and return only the access token to the body. The refresh token is the
   * cookie VALUE by design (a bearer credential), delivered hardened: httpOnly + Secure (prod) +
   * SameSite=strict, and stored server-side only as sha256 with rotation/reuse-detection. CodeQL's
   * `js/clear-text-storage` here is a false positive (it has no model of cookie attributes); see ADR-0027.
   */
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

/** Access token from the `Authorization: Bearer <jwt>` header, or null if absent/malformed. */
function bearerFrom(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
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
  if (error instanceof InvalidResetTokenError)
    return new BadRequestException('invalid or expired reset token');
  if (error instanceof EmailAlreadyRegisteredError)
    return new ConflictException('email already registered');
  if (error instanceof z.ZodError) return new BadRequestException(error.issues);
  return error instanceof Error ? error : new Error(String(error));
}
