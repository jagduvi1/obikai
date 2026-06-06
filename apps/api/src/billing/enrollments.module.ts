import { Module } from '@nestjs/common';
import { EnrollmentRepository } from '@obikai/db';
import { EnrollmentsController } from './enrollments.controller.js';
import { EnrollmentsService } from './enrollments.service.js';

/**
 * Enrollments feature module. The service is constructed with the tenant-scoped
 * EnrollmentRepository from @obikai/db; the repository's guard reads the per-request TenantContext,
 * so no tenant wiring is needed here (ADR-0004).
 */
@Module({
  controllers: [EnrollmentsController],
  providers: [
    {
      provide: EnrollmentsService,
      useFactory: () => new EnrollmentsService(new EnrollmentRepository()),
    },
  ],
})
export class EnrollmentsModule {}
