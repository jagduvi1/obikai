import { Module } from '@nestjs/common';
import { AttendanceRepository } from '@obikai/db';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

/**
 * Attendance feature module (ADR-0014, scope §4.4). The service is constructed with the
 * tenant-scoped AttendanceRepository from @obikai/db; the repository's guard reads the per-request
 * TenantContext, so no tenant wiring is needed here (ADR-0004).
 */
@Module({
  controllers: [AttendanceController],
  providers: [
    {
      provide: AttendanceService,
      useFactory: () => new AttendanceService(new AttendanceRepository()),
    },
  ],
})
export class AttendanceModule {}
