import { Global, type INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppConfig } from '@obikai/config';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../config.provider.js';
import { PlatformModule } from './platform.module.js';

/**
 * HTTP-level regression guard for the platform plane's middleware wiring (ADR-0022). The whole plane
 * hinges on `PlatformMiddleware` actually binding to `/platform/*` — a property that is invisible to
 * the TS build and unit tests, and that a wrong `forRoutes` pattern silently breaks (the legacy
 * Express path-to-regexp parses `(.*)` as an optional `.ext`). If the middleware is bound, an
 * unauthenticated request is rejected at 401 BEFORE any controller/mongo access; if it were NOT bound
 * the controller would run and 500. So these 401s prove the security middleware runs on every route
 * shape — including nested ones. No Mongo needed: the 401 path never reaches a repository.
 *
 * SCOPE NOTE: these assert the unauthenticated path only, which deliberately touches NO injected
 * dependency. Vitest transpiles via esbuild, which does not emit `design:paramtypes`, so Nest's
 * constructor injection yields undefined here — fine for the no-auth path, but it means the DI-backed
 * branches (token verification, grant lookup) can't be exercised in this runner. Those are covered by
 * the pure `decidePlatformAccess` unit tests + the production build (`emitDecoratorMetadata: true`).
 */

// Minimal config: what TokenService, the auth controller, and the (transitively imported)
// notifications SMTP provider read at construction. PlatformModule → AuthModule → NotificationsModule,
// so the EMAIL_PORT factory needs an `email` block even though these tests never send mail.
const config = {
  tenancy: 'single',
  baseDomain: 'localhost',
  appName: 'Obikai',
  appPublicUrl: null,
  auth: { jwtSecret: 'x'.repeat(32), accessTtl: '15m', refreshTtl: '7d' },
  email: {
    provider: 'smtp',
    from: 'noreply@example.test',
    smtp: { host: 'localhost', port: 587, secure: false, user: null, pass: null },
  },
} as AppConfig;

@Global()
@Module({ providers: [{ provide: APP_CONFIG, useValue: config }], exports: [APP_CONFIG] })
class TestConfigModule {}

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TestConfigModule, PlatformModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('platform plane middleware wiring', () => {
  it('rejects an unauthenticated GET /platform/tenants with 401 (middleware is bound)', async () => {
    await request(app.getHttpServer()).get('/platform/tenants').expect(401);
  });

  it('also guards nested routes — /platform/tenants/:slug and .../usage → 401 unauth', async () => {
    // Proves the catch-all binds nested routes too (the exact shapes the buggy pattern missed).
    await request(app.getHttpServer()).get('/platform/tenants/acme').expect(401);
    await request(app.getHttpServer()).get('/platform/tenants/acme/usage').expect(401);
  });

  it('also guards the audit endpoint — /platform/audit → 401 unauth', async () => {
    await request(app.getHttpServer()).get('/platform/audit').expect(401);
  });

  it('does not leave the plane unbound (an unknown /platform path is still middleware-gated)', async () => {
    // Any /platform/* path is owned by the platform middleware; an unmapped one is 401 (gated),
    // never a tenant 404 — confirming TenancyMiddleware does not run here.
    const res = await request(app.getHttpServer()).get('/platform/anything/else');
    expect(res.status).toBe(401);
  });
});
