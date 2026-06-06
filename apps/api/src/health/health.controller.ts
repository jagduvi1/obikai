import { Controller, Get } from '@nestjs/common';
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
   * Readiness: probes each hard dependency. Stubs return true for now; real implementations will
   * ping Mongo/Redis, compare the applied migration head, and verify the email transport handshake.
   */
  @Get('readyz')
  async readyz(): Promise<ReadyzResponse> {
    const checks = await this.collectChecks();
    const ready = Object.values(checks).every((ok) => ok);
    return { ready, checks };
  }

  /** STUB: every probe returns true until the db / queue / mailer wiring lands. */
  private async collectChecks(): Promise<ReadyzChecks> {
    return {
      mongo: true,
      redis: true,
      migrationsApplied: true,
      emailTransport: true,
    };
  }
}
