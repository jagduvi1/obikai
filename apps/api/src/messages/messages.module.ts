import { Module } from '@nestjs/common';
import {
  AuditLogRepository,
  ConsentRepository,
  MemberRepository,
  MessageLogRepository,
} from '@obikai/db';
import type { TenantId, UserId } from '@obikai/domain';
import { NotificationsService } from '@obikai/notifications';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BroadcastService } from './broadcast.service.js';
import { MessagesController } from './messages.controller.js';

/**
 * Messaging feature module (scope §4.8). BroadcastService composes the tenant-scoped repositories
 * (members / consent / message-log / audit) with NotificationsService (email transport) from the
 * NotificationsModule. The consent lookup ignores the tenantId arg (the guard scopes by context), so
 * a placeholder is passed.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [MessagesController],
  providers: [
    {
      provide: BroadcastService,
      useFactory: (notifications: NotificationsService) => {
        const consent = new ConsentRepository();
        return new BroadcastService(
          new MemberRepository(),
          {
            currentStatus: (subjectId: string, purpose: string) =>
              consent.currentStatus('' as TenantId, subjectId as UserId, purpose),
          },
          notifications,
          new MessageLogRepository(),
          new AuditLogRepository(),
        );
      },
      inject: [NotificationsService],
    },
  ],
})
export class MessagesModule {}
