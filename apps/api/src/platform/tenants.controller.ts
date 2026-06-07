import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Req,
} from '@nestjs/common';
import { type PlatformActor, canPlatform } from '@obikai/authz';
import type { AppConfig } from '@obikai/config';
import {
  MemberRepository,
  PlatformAuditRepository,
  type TenantContext,
  TenantRegistryRepository,
  runInTenantContext,
} from '@obikai/db';
import type { PlatformPermission } from '@obikai/domain';
import { APP_CONFIG } from '../config.provider.js';
import { type PlatformRequest, getPlatformActor } from './platform-access.js';

/**
 * Platform tenant oversight (ADR-0021/0022) — READ-ONLY. The request already runs under
 * `runAsPlatform` (PlatformMiddleware), so the platform-aware TenantRegistryRepository works here;
 * per-tenant usage is read by briefly opening `runInTenantContext(slug)` so the guarded MemberRepository
 * scopes to exactly that tenant (an explicit, audited platform→tenant read). Authorization is the pure
 * `canPlatform`; no endpoint mutates tenant data (there is no platform write action).
 */
@Controller('platform/tenants')
export class PlatformTenantsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly tenants: TenantRegistryRepository,
    private readonly members: MemberRepository,
    private readonly audit: PlatformAuditRepository,
  ) {}

  @Get()
  async list(@Req() req: PlatformRequest) {
    const actor = getPlatformActor(req);
    this.authorize(actor, { resource: 'tenant', action: 'list' });
    const tenants = await this.tenants.list();
    await this.record(req, actor, 'tenant.list', '*');
    return tenants;
  }

  @Get(':slug')
  async get(@Req() req: PlatformRequest, @Param('slug') slug: string) {
    const actor = getPlatformActor(req);
    this.authorize(actor, { resource: 'tenant', action: 'read' });
    // Record the probe (raw slug) BEFORE the existence check so negative probes — tenant-namespace
    // enumeration — are also audited, not just hits (ADR-0023: every platform read is recorded).
    await this.record(req, actor, 'tenant.read', slug);
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) throw new NotFoundException('unknown tenant');
    return tenant;
  }

  @Get(':slug/usage')
  async usage(@Req() req: PlatformRequest, @Param('slug') slug: string) {
    const actor = getPlatformActor(req);
    this.authorize(actor, { resource: 'usage', action: 'read' });
    await this.record(req, actor, 'tenant.usage.read', slug);
    const tenant = await this.tenants.findBySlug(slug);
    if (!tenant) throw new NotFoundException('unknown tenant');

    // Briefly scope INTO the tenant to count its data through the normal guarded repository.
    const ctx: TenantContext = {
      tenantId: tenant.slug,
      userId: null,
      sessionId: null,
      roles: [],
      memberId: null,
      requestId: `platform-usage:${tenant.slug}`,
      tenancy: this.config.tenancy,
    };
    const [members, activeMembers] = await runInTenantContext(ctx, async () => [
      await this.members.count(),
      await this.members.count({ status: 'active' }),
    ]);
    return { tenantId: tenant.slug, status: tenant.status, members, activeMembers };
  }

  private authorize(actor: PlatformActor, perm: PlatformPermission): void {
    if (!canPlatform(actor, perm)) throw new ForbiddenException('forbidden');
  }

  /** Record the read to the tamper-evident platform audit log (ADR-0023), in platform scope. */
  private record(
    req: PlatformRequest,
    actor: PlatformActor,
    action: string,
    targetId: string,
  ): Promise<unknown> {
    return this.audit.append({
      actorUserId: actor.userId,
      action,
      targetType: 'tenant',
      targetId,
      ip: req.ip ?? null,
    });
  }
}
