import { Module } from '@nestjs/common';
import { AuditLogRepository, MemberRepository } from '@obikai/db';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

/**
 * Members feature module. The service is constructed with the tenant-scoped MemberRepository and the
 * per-tenant AuditLogRepository from @obikai/db; both guards read the per-request TenantContext, so no
 * tenant wiring is needed here (ADR-0004). Every member mutation is recorded on the tenant's audit
 * chain (ADR-0026, audit H9).
 */
@Module({
  controllers: [MembersController],
  providers: [
    {
      provide: MembersService,
      useFactory: () => new MembersService(new MemberRepository(), new AuditLogRepository()),
    },
  ],
})
export class MembersModule {}
