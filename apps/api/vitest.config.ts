import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Unit-test config for apps/api — vitest's default (fast esbuild) transform, unchanged. Integration
 * tests live under `test/**` and run with their OWN config (vitest.int.config.ts): booting the real
 * Nest app needs SWC-emitted decorator metadata, which esbuild strips (`design:paramtypes`), and the
 * existing unit tests (incl. platform.wiring.test.ts) deliberately rely on the esbuild behaviour. So
 * we EXCLUDE the integration files here and run them separately.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
