import { Module } from '@nestjs/common';
import { LocationRepository } from '@obikai/db';
import { LocationsController } from './locations.controller.js';
import { LocationsService } from './locations.service.js';

/**
 * Locations feature module (scope §4.10). The service is constructed with the tenant-scoped
 * LocationRepository from @obikai/db; the repository's guard reads the per-request TenantContext, so
 * no tenant wiring is needed here (ADR-0004).
 */
@Module({
  controllers: [LocationsController],
  providers: [
    {
      provide: LocationRepository,
      useFactory: () => new LocationRepository(),
    },
    {
      provide: LocationsService,
      useFactory: (repo: LocationRepository) => new LocationsService(repo),
      inject: [LocationRepository],
    },
  ],
})
export class LocationsModule {}
