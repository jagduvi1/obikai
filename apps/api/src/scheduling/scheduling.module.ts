import { Module } from '@nestjs/common';
import {
  BookingRepository,
  ClassOccurrenceRepository,
  ClassScheduleRepository,
  ProgramRepository,
} from '@obikai/db';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { OccurrencesController } from './occurrences.controller.js';
import { OccurrencesService } from './occurrences.service.js';
import { ProgramsController } from './programs.controller.js';
import { ProgramsService } from './programs.service.js';
import { SchedulesController } from './schedules.controller.js';
import { SchedulesService } from './schedules.service.js';

/**
 * Classes & scheduling feature module (scope §4.3, ADR-0014). Services are framework-free and built
 * with the tenant-scoped repositories from @obikai/db; the repositories' guard reads the per-request
 * TenantContext, so no tenant wiring is needed here (ADR-0004). Repositories are provided so the
 * occurrence/booking services can compose multiple repos (occurrence materialization needs the
 * schedule lookup; booking capacity needs the occurrence lookup).
 */
@Module({
  controllers: [ProgramsController, SchedulesController, OccurrencesController, BookingsController],
  providers: [
    { provide: ProgramRepository, useFactory: () => new ProgramRepository() },
    { provide: ClassScheduleRepository, useFactory: () => new ClassScheduleRepository() },
    { provide: ClassOccurrenceRepository, useFactory: () => new ClassOccurrenceRepository() },
    { provide: BookingRepository, useFactory: () => new BookingRepository() },
    {
      provide: ProgramsService,
      useFactory: (repo: ProgramRepository) => new ProgramsService(repo),
      inject: [ProgramRepository],
    },
    {
      provide: SchedulesService,
      useFactory: (repo: ClassScheduleRepository) => new SchedulesService(repo),
      inject: [ClassScheduleRepository],
    },
    {
      provide: OccurrencesService,
      useFactory: (occ: ClassOccurrenceRepository, sched: ClassScheduleRepository) =>
        new OccurrencesService(occ, sched),
      inject: [ClassOccurrenceRepository, ClassScheduleRepository],
    },
    {
      provide: BookingsService,
      useFactory: (repo: BookingRepository, occ: ClassOccurrenceRepository) =>
        new BookingsService(repo, occ),
      inject: [BookingRepository, ClassOccurrenceRepository],
    },
  ],
})
export class SchedulingModule {}
