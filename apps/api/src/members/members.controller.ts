import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Ip,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthzActor } from '@obikai/authz';
import type { AppConfig } from '@obikai/config';
import { TenantRegistryRepository, getTenantContextOrThrow } from '@obikai/db';
import {
  DEFAULT_LOCALE,
  type MemberStatus,
  memberCreateSchema,
  memberStatusSchema,
  memberTagsSchema,
  memberUpdateSchema,
} from '@obikai/domain';
import { NotificationsService } from '@obikai/notifications';
import { z } from 'zod';
import { APP_CONFIG } from '../config.provider.js';
import {
  InviteAlreadyLinkedError,
  InviteNoEmailError,
  type MemberInviteRequest,
  MemberInviteService,
} from './member-invite.service.js';
import { ForbiddenError, MembersService, NotFoundError } from './members.service.js';

/**
 * Members REST endpoints (scope §4.1). The actor is derived from the request's TenantContext
 * (opened by TenancyMiddleware, ADR-0004); authorization is enforced in MembersService via can().
 * NOTE: until the auth slice lands, the context carries no verified roles, so these endpoints are
 * effectively locked down (deny-by-default) — exactly the safe failure mode we want.
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
  if (error instanceof InviteNoEmailError) throw new BadRequestException(error.message);
  if (error instanceof InviteAlreadyLinkedError) throw new ConflictException(error.message);
  if (error instanceof z.ZodError) throw new BadRequestException(error.issues);
  throw error;
}

@Controller('members')
export class MembersController {
  readonly #appName: string;
  readonly #appPublicUrl: string | null;
  readonly #tenants = new TenantRegistryRepository();

  constructor(
    private readonly service: MembersService,
    private readonly invites: MemberInviteService,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.#appName = config.appName;
    this.#appPublicUrl = config.appPublicUrl;
  }

  @Post()
  async create(@Body() body: unknown, @Ip() ip: string) {
    try {
      return await this.service.create(currentActor(), memberCreateSchema.parse(body), { ip });
    } catch (error) {
      translate(error);
    }
  }

  @Get()
  async list(@Query('status') status?: string, @Query('tag') tag?: string) {
    try {
      const parsed: MemberStatus | undefined = status
        ? memberStatusSchema.parse(status)
        : undefined;
      return await this.service.list(currentActor(), {
        ...(parsed ? { status: parsed } : {}),
        ...(tag ? { tag } : {}),
      });
    } catch (error) {
      translate(error);
    }
  }

  /**
   * Free-text member lookup (kiosk roster add, comms recipient picker). Declared BEFORE `:id` so
   * `/members/search` is not captured as a member id. Empty `q` returns [].
   */
  @Get('search')
  async search(@Query('q') q?: string, @Query('limit') limit?: string) {
    try {
      const cap = limit ? z.coerce.number().int().min(1).max(100).parse(limit) : undefined;
      return await this.service.search(currentActor(), q ?? '', cap);
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

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown, @Ip() ip: string) {
    try {
      return await this.service.update(currentActor(), id, memberUpdateSchema.parse(body), { ip });
    } catch (error) {
      translate(error);
    }
  }

  /** Replace a member's tag set (segment labels). Authorized as a member update; audited as such. */
  @Put(':id/tags')
  async setTags(@Param('id') id: string, @Body() body: unknown, @Ip() ip: string) {
    try {
      const tags = memberTagsSchema.parse((body as { tags?: unknown })?.tags ?? body);
      return await this.service.update(currentActor(), id, { tags }, { ip });
    } catch (error) {
      translate(error);
    }
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Ip() ip: string) {
    try {
      await this.service.remove(currentActor(), id, { ip });
    } catch (error) {
      translate(error);
    }
  }

  /**
   * Invite a member to set up a portal login (onboarding). Staff-authed (member:update); mints a
   * single-use token and emails the accept link. 400 if the member has no email, 409 if already linked.
   */
  @Post(':id/invite')
  @HttpCode(204)
  async invite(@Param('id') id: string) {
    try {
      const { tenantId } = getTenantContextOrThrow();
      const request = await this.invites.createInvite(currentActor(), tenantId, id);
      await this.sendInviteEmail(tenantId, request);
    } catch (error) {
      translate(error);
    }
  }

  /** Email the invite link. The dojo name comes from the tenant registry; the link from APP_PUBLIC_URL
   *  (raw token when unset). A delivery failure surfaces to staff (not swallowed) — re-inviting supersedes. */
  private async sendInviteEmail(tenantId: string, request: MemberInviteRequest): Promise<void> {
    const tenant = await this.#tenants.findBySlug(tenantId);
    const dojoName = tenant?.name ?? this.#appName;
    const acceptUrl =
      this.#appPublicUrl !== null
        ? `${this.#appPublicUrl}/accept-invite?token=${encodeURIComponent(request.token)}`
        : null;
    await this.notifications.sendMemberInvite(
      { email: request.email, name: request.memberName },
      DEFAULT_LOCALE,
      { acceptUrl, token: request.token, expiresInHours: 7 * 24 },
      { name: request.memberName, dojoName, tenantDefaultLocale: DEFAULT_LOCALE },
    );
  }
}
