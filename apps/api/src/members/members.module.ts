import { Module } from '@nestjs/common';
import { MemberRepository } from '@obikai/db';
import { MembersController } from './members.controller.js';
import { MembersService } from './members.service.js';

/**
 * Members feature module. The service is constructed with the tenant-scoped MemberRepository from
 * @obikai/db; the repository's guard reads the per-request TenantContext, so no tenant wiring is
 * needed here (ADR-0004).
 */
@Module({
  controllers: [MembersController],
  providers: [
    {
      provide: MembersService,
      useFactory: () => new MembersService(new MemberRepository()),
    },
  ],
})
export class MembersModule {}
