import { Controller, Get } from '@nestjs/common';
import { isMongoConnected } from '@obikai/db';
import type { HealthzResponse, ReadyzChecks, ReadyzResponse } from './readyz.types.js';

/**
 * Liveness + readiness probes. Liveness (`/healthz`) answers "is the process up?" and must stay
 * dependency-free so a stuck downstream never kills an otherwise-healthy pod. Readiness
 * (`/readyz`) reports per-dependency checks so traffic is only routed once the app can actually
 * serve (ADR-0009 includes an email-transport probe here).
 */
@Controller()
export class HealthController {
  /** Liveness: cheap, no I/O, always ok if the event loop is running. */
  @Get('healthz')
  healthz(): HealthzResponse {
    return { status: 'ok' };
  }

  /**
   * Readiness: true only when every hard dependency is reachable, so an orchestrator never routes
   * traffic to an instance that can't serve. Reflects REAL state — today that is the live Mongo
   * connection (every request hits a tenant-scoped repository).
   */
  @Get('readyz')
  async readyz(): Promise<ReadyzResponse> {
    const checks: ReadyzChecks = { mongo: isMongoConnected() };
    const ready = Object.values(checks).every((ok) => ok);
    return { ready, checks };
  }
}
