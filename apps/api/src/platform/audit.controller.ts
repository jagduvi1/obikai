import { Controller, ForbiddenException, Get, Req } from '@nestjs/common';
import { canPlatform } from '@obikai/authz';
import { PlatformAuditRepository } from '@obikai/db';
import { type PlatformRequest, getPlatformActor } from './platform-access.js';

/**
 * Read the platform audit log (ADR-0023). The whole tamper-evident chain, oldest→newest; the caller
 * can re-verify it with `verifyPlatformAuditChain`. Gated on `auditLog:list`; the request already
 * runs under `runAsPlatform` (PlatformMiddleware), which the repository's `list` requires. Reading the
 * audit log is itself NOT audited (it would grow the chain on every inspection with no added signal).
 */
@Controller('platform/audit')
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditRepository) {}

  @Get()
  async list(@Req() req: PlatformRequest) {
    const actor = getPlatformActor(req);
    if (!canPlatform(actor, { resource: 'auditLog', action: 'list' })) {
      throw new ForbiddenException('forbidden');
    }
    return this.audit.list();
  }
}
