import { Module } from '@nestjs/common';
import { CapabilitiesController } from './capabilities.controller.js';

/** Serves the public capabilities snapshot. Reads AppConfig (APP_CONFIG) — provided globally by
 * the root module, so nothing extra to register here. */
@Module({
  controllers: [CapabilitiesController],
})
export class CapabilitiesModule {}
