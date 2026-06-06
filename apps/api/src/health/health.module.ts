import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

/** Exposes liveness/readiness probes. No dependencies — safe to mount before anything else. */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
