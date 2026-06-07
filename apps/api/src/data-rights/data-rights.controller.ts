import { Controller, Get, Header, Ip, UnauthorizedException } from '@nestjs/common';
import { getTenantContextOrThrow } from '@obikai/db';
import { DataExportService, type ExportSubject } from './data-export.service.js';

/**
 * Data-subject rights endpoints under `/me` (GDPR Arts. 15/20 here; erasure lands in G6). Self-service:
 * the subject is always the authenticated user. Anonymous requests get 401.
 */
@Controller('me')
export class DataRightsController {
  constructor(private readonly exportService: DataExportService) {}

  private subject(ip: string): ExportSubject {
    const ctx = getTenantContextOrThrow();
    if (!ctx.userId) throw new UnauthorizedException('not authenticated');
    return {
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      memberId: ctx.memberId ?? null,
      ip,
    };
  }

  /**
   * GET /me/data-export — download a machine-readable copy of all the caller's personal data
   * (Art. 15/20). Returned as a JSON attachment; the access is audited.
   */
  @Get('data-export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="obikai-data-export.json"')
  async export(@Ip() ip: string): Promise<unknown> {
    return this.exportService.export(this.subject(ip));
  }
}
