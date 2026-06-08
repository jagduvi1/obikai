import { Module } from '@nestjs/common';
import { AuditLogRepository, MemberRepository } from '@obikai/db';
import { MembersService } from '../members/members.service.js';
import { MeController } from './me.controller.js';

/**
 * Exposes GET /me (the current principal) and the member-app profile self-service (/me/profile).
 * MembersService is constructed with the tenant-scoped MemberRepository + per-tenant AuditLogRepository
 * (ADR-0004/0026) — the same wiring as MembersModule; reused here so /me/profile updates are audited.
 */
@Module({
  controllers: [MeController],
  providers: [
    {
      provide: MembersService,
      useFactory: () => new MembersService(new MemberRepository(), new AuditLogRepository()),
    },
  ],
})
export class MeModule {}
