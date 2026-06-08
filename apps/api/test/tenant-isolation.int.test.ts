import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, bootTestApi } from './harness.js';

/**
 * I2 — two-tenant isolation. The structural multi-tenancy guarantee (ADR-0004): the tenant is resolved
 * from the request Host, never the token, and authority comes from a per-tenant Membership. So the
 * SAME access token grants authority in its own tenant and NONE in another, and a tenant's data is
 * never visible across the boundary. This drives the real app over HTTP to prove that end-to-end.
 */

const ALPHA = {
  slug: 'alpha',
  host: 'alpha.localhost',
  email: 'owner@alpha.test',
  pw: 'alpha-password-1',
};
const BRAVO = {
  slug: 'bravo',
  host: 'bravo.localhost',
  email: 'owner@bravo.test',
  pw: 'bravo-password-1',
};

let api: TestApi;

beforeAll(async () => {
  api = await bootTestApi();
  await api.seedTenantOwner(ALPHA.slug, ALPHA.email, ALPHA.pw);
  await api.seedTenantOwner(BRAVO.slug, BRAVO.email, BRAVO.pw);
}, 120_000);

afterAll(async () => {
  await api?.stop();
});

describe('api integration — two-tenant isolation (I2)', () => {
  it('scopes data to the resolved tenant and never leaks across the boundary', async () => {
    const alphaAuth = `Bearer ${await api.login(ALPHA.email, ALPHA.pw)}`;
    const bravoAuth = `Bearer ${await api.login(BRAVO.email, BRAVO.pw)}`;

    // Each owner creates one member in their own tenant.
    const alphaMember = await api
      .http()
      .post('/members')
      .set('Host', ALPHA.host)
      .set('Authorization', alphaAuth)
      .send({ firstName: 'Alice', lastName: 'Alpha' })
      .expect(201);
    const bravoMember = await api
      .http()
      .post('/members')
      .set('Host', BRAVO.host)
      .set('Authorization', bravoAuth)
      .send({ firstName: 'Bob', lastName: 'Bravo' })
      .expect(201);

    // Alpha sees only Alpha's member; Bravo sees only Bravo's.
    const alphaList = await api
      .http()
      .get('/members')
      .set('Host', ALPHA.host)
      .set('Authorization', alphaAuth)
      .expect(200);
    const alphaIds = alphaList.body.map((m: { id: string }) => m.id);
    expect(alphaIds).toContain(alphaMember.body.id);
    expect(alphaIds).not.toContain(bravoMember.body.id);

    const bravoList = await api
      .http()
      .get('/members')
      .set('Host', BRAVO.host)
      .set('Authorization', bravoAuth)
      .expect(200);
    const bravoIds = bravoList.body.map((m: { id: string }) => m.id);
    expect(bravoIds).toContain(bravoMember.body.id);
    expect(bravoIds).not.toContain(alphaMember.body.id);
  });

  it('rejects a valid token used against another tenant (no membership there → 403)', async () => {
    // Alpha's owner token, but pointed at Bravo's host: the middleware resolves tenant=bravo, finds no
    // membership for this user there, so the actor is role-less and can() denies the list.
    const alphaAuth = `Bearer ${await api.login(ALPHA.email, ALPHA.pw)}`;
    await api
      .http()
      .get('/members')
      .set('Host', BRAVO.host)
      .set('Authorization', alphaAuth)
      .expect(403);
  });

  it('cannot read another tenant’s member by id even when guessing the id', async () => {
    const alphaAuth = `Bearer ${await api.login(ALPHA.email, ALPHA.pw)}`;
    const bravoAuth = `Bearer ${await api.login(BRAVO.email, BRAVO.pw)}`;
    const bravoMember = await api
      .http()
      .post('/members')
      .set('Host', BRAVO.host)
      .set('Authorization', bravoAuth)
      .send({ firstName: 'Carol', lastName: 'Bravo' })
      .expect(201);

    // Alpha owner, alpha host, asking for a Bravo member id → not in alpha's tenant → 404.
    await api
      .http()
      .get(`/members/${bravoMember.body.id}`)
      .set('Host', ALPHA.host)
      .set('Authorization', alphaAuth)
      .expect(404);
  });

  it('returns 404 for an unresolvable tenant host (apex, no subdomain)', async () => {
    await api.http().get('/members').set('Host', 'localhost').expect(404);
  });

  it('denies an unauthenticated request to a valid tenant (role-less → 403)', async () => {
    await api.http().get('/members').set('Host', ALPHA.host).expect(403);
  });
});
