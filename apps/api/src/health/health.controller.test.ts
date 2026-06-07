import * as db from '@obikai/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';

/**
 * /readyz must reflect REAL dependency state, not a hardcoded true (audit F1) — otherwise an
 * orchestrator routes traffic to an instance with a dead database.
 */
describe('HealthController', () => {
  const controller = new HealthController();
  afterEach(() => vi.restoreAllMocks());

  it('/healthz is dependency-free liveness', () => {
    expect(controller.healthz()).toEqual({ status: 'ok' });
  });

  it('/readyz is NOT ready when Mongo is disconnected', async () => {
    vi.spyOn(db, 'isMongoConnected').mockReturnValue(false);
    expect(await controller.readyz()).toEqual({ ready: false, checks: { mongo: false } });
  });

  it('/readyz is ready when Mongo is connected', async () => {
    vi.spyOn(db, 'isMongoConnected').mockReturnValue(true);
    expect(await controller.readyz()).toEqual({ ready: true, checks: { mongo: true } });
  });
});
