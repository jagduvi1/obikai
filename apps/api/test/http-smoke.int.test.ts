import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApi, bootTestApi } from './harness.js';

/**
 * I1 — HTTP/controller integration. Boots the real Nest app (full DI) against an ephemeral Mongo and
 * drives it over HTTP: liveness, the real login flow, and a member create→list round-trip that goes
 * controller → service → repository → MongoDB and back. This is the wiring the unit (service-with-fakes)
 * tests can't reach.
 */

const HOST = 'smoke.localhost';
const OWNER = { email: 'owner@smoke.test', password: 'owner-password-123' };

let api: TestApi;

beforeAll(async () => {
  api = await bootTestApi();
  await api.seedTenantOwner('smoke', OWNER.email, OWNER.password);
}, 120_000);

afterAll(async () => {
  await api?.stop();
});

describe('api integration — HTTP smoke (I1)', () => {
  it('serves liveness without a tenant or auth', async () => {
    await api.http().get('/healthz').expect(200);
  });

  it('logs in with valid credentials and rejects bad ones', async () => {
    // Login is a POST that mints a session → Nest's default 201 (not 200).
    const ok = await api.http().post('/auth/login').send(OWNER).expect(201);
    expect(typeof ok.body.accessToken).toBe('string');
    expect(ok.body.accessToken.length).toBeGreaterThan(0);

    await api
      .http()
      .post('/auth/login')
      .send({ email: OWNER.email, password: 'wrong-password-xx' })
      .expect(401);
  });

  it('round-trips a member create → list through real DI + Mongo (owner authed)', async () => {
    const auth = `Bearer ${await api.login(OWNER.email, OWNER.password)}`;

    const created = await api
      .http()
      .post('/members')
      .set('Host', HOST)
      .set('Authorization', auth)
      .send({ firstName: 'Aiko', lastName: 'Tanaka' })
      .expect(201);
    expect(typeof created.body.id).toBe('string');
    expect(created.body.firstName).toBe('Aiko');

    const list = await api
      .http()
      .get('/members')
      .set('Host', HOST)
      .set('Authorization', auth)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.map((m: { id: string }) => m.id)).toContain(created.body.id);
  });

  it('denies an unauthenticated member list (role-less actor → 403)', async () => {
    await api.http().get('/members').set('Host', HOST).expect(403);
  });
});
