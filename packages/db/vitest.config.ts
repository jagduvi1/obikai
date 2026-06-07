import { defineConfig } from 'vitest/config';

/**
 * The only customization over vitest defaults: a global setup that pre-downloads the in-memory MongoDB
 * binary once before parallel workers spawn, so they don't race to download it on a cold cache (the
 * `.downloading` rename ENOENT seen in CI). See `test/global-setup.ts`.
 */
export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
  },
});
