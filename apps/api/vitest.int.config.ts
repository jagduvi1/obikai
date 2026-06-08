import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration-test config: boots the REAL NestJS app (`AppModule.forRoot`) via @nestjs/testing against
 * an ephemeral in-memory MongoDB and drives it over HTTP with supertest (see test/harness.ts).
 *
 * Why a separate config: Nest constructor DI reads `design:paramtypes` reflection metadata, which
 * vitest's default esbuild transform does NOT emit — so a full app boot would resolve every injected
 * dependency to `undefined`. unplugin-swc transpiles with `emitDecoratorMetadata`, mirroring the
 * production `tsc` build, so the container wires real providers (controllers → services → repositories).
 */
export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        // legacyDecorator + decoratorMetadata mirror apps/api/tsconfig.json (experimentalDecorators +
        // emitDecoratorMetadata) so the booted DI graph matches the shipped build.
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    include: ['test/**/*.int.test.ts'],
    // Pre-download the mongodb-memory-server binary once before workers spawn (cold-cache race guard).
    globalSetup: ['./test/global-setup.ts'],
    // Each file boots its own Mongo + Nest app and shares a single global mongoose connection, so run
    // files serially to avoid clobbering that connection across files.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
