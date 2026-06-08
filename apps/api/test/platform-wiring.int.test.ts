import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, bootTestApi } from './harness.js';

/**
 * HTTP-level regression guard for two routing properties that the TS build can't see and a wrong
 * route pattern silently breaks — now asserted against the REAL booted app (full DI + SWC metadata):
 *
 *  1. `PlatformMiddleware` binds to `/platform/*` (ADR-0022). If it is bound, an unauthenticated
 *     request is rejected at 401 BEFORE any controller/Mongo access; if it were NOT bound the
 *     controller would run and 500. So these 401s prove the security middleware runs on every
 *     `/platform` route shape, including nested and unmapped ones.
 *  2. The fs storage `FilesController` wildcard route (`@Get('*')`) actually MATCHES nested paths.
 *     path-to-regexp 8 (Express 5, via NestJS 11) rejects bare `*` at registration — a 403 (invalid
 *     token) rather than a 404 (no route) proves Nest's pattern handling keeps the catch-all working.
 *
 * This replaces the former src/platform/platform.wiring.test.ts, which booted PlatformModule under
 * esbuild and relied on constructor-injected deps resolving to `undefined` for the no-auth path.
 * NestJS 11's injector is strict and throws on an unresolved param, so that esbuild shortcut is no
 * longer viable — the real-app integration boot is the correct home for an HTTP wiring guard.
 */

const HOST = 'wiring.localhost';
const OWNER = { email: 'owner@wiring.test', password: 'owner-password-123' };

let api: TestApi;

beforeAll(async () => {
  api = await bootTestApi();
  await api.seedTenantOwner('wiring', OWNER.email, OWNER.password);
}, 120_000);

afterAll(async () => {
  await api?.stop();
});

describe('platform plane middleware wiring (I — real app)', () => {
  it('rejects an unauthenticated GET /platform/tenants with 401 (middleware is bound)', async () => {
    await api.http().get('/platform/tenants').expect(401);
  });

  it('also guards nested routes — /platform/tenants/:slug and .../usage → 401 unauth', async () => {
    // Proves the catch-all binds nested routes too (the exact shapes a buggy pattern misses).
    await api.http().get('/platform/tenants/acme').expect(401);
    await api.http().get('/platform/tenants/acme/usage').expect(401);
  });

  it('also guards the audit endpoint — /platform/audit → 401 unauth', async () => {
    await api.http().get('/platform/audit').expect(401);
  });

  it('does not leave the plane unbound (an unknown /platform path is still middleware-gated)', async () => {
    // Any /platform/* path is owned by the platform middleware; an unmapped one is 401 (gated),
    // never a tenant 404 — confirming TenancyMiddleware does not run here.
    const res = await api.http().get('/platform/anything/else');
    expect(res.status).toBe(401);
  });
});

describe('fs storage wildcard route wiring (I — real app)', () => {
  it('matches a nested /files/* path under Express 5 (403 invalid token, not 404 no-route)', async () => {
    // The fs FilesController is mounted (the int harness runs STORAGE_PROVIDER=fs). A nested path with
    // no signing query reaches the handler and is rejected 403 — proving @Get('*') still MATCHES.
    const res = await api.http().get('/files/tenant/a/b/object.txt').set('Host', HOST);
    expect(res.status).toBe(403);
  });
});
