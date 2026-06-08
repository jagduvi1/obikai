import { Module } from '@nestjs/common';
import {
  AttendanceRepository,
  BookingRepository,
  ClassOccurrenceRepository,
  ProgramRepository,
} from '@obikai/db';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { CheckInService } from './check-in.service.js';

/**
 * Attendance feature module (ADR-0014, scope §4.4). Services are constructed with the tenant-scoped
 * repositories from @obikai/db; each repository's guard reads the per-request TenantContext, so no
 * tenant wiring is needed here (ADR-0004). CheckInService composes attendance + scheduling repos for
 * member self check-in.
 */
@Module({
  controllers: [AttendanceController],
  providers: [
    {
      provide: AttendanceService,
      useFactory: () => new AttendanceService(new AttendanceRepository()),
    },
    {
      provide: CheckInService,
      useFactory: () =>
        new CheckInService(
          new AttendanceRepository(),
          new ClassOccurrenceRepository(),
          new ProgramRepository(),
          new BookingRepository(),
        ),
    },
  ],
})
export class AttendanceModule {}
