import { defineConfig } from 'vitest/config';

/**
 * Worker test config. The worker is framework-free (no Nest DI), so the default esbuild transform is
 * fine — no SWC needed. The only customisation: pre-download the mongodb-memory-server binary once
 * (cold-cache race guard, mirrors packages/db) and give the integration test room to stand up Mongo +
 * a real Redis-backed BullMQ worker. The Redis-backed suite SKIPS when no Redis is reachable (and
 * fails loudly in CI, where one is provided) — see test/worker-jobs.int.test.ts.
 */
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
