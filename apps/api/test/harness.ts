import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashPassword } from '@obikai/adapter-auth-local';
import { type AppConfig, loadConfig } from '@obikai/config';
import {
  IdentityRepository,
  MembershipRepository,
  type TenantContext,
  TenantRegistryRepository,
  UserRepository,
  connectMongo,
  disconnectMongo,
  runInTenantContext,
} from '@obikai/db';
import type { RoleAssignment } from '@obikai/domain';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter.js';

/**
 * Integration-test harness: boots the REAL NestJS app (full DI graph) over an ephemeral in-memory
 * MongoDB, plus helpers to seed tenants and obtain access tokens. The app runs in HOSTED-style
 * `multi` tenancy so a request's tenant is resolved from the `Host` header (`<slug>.localhost`) —
 * the property the tenant-isolation tests exercise. DEPLOY_MODE stays `self-host` so the hosted-only
 * datastore-credential guard (G2) doesn't reject the credential-less in-memory Mongo.
 */
export interface TestApi {
  readonly app: INestApplication;
  readonly config: AppConfig;
  /** Seed a tenant + an owner login (tenant-global user/identity + an active owner membership). */
  seedTenantOwner(slug: string, email: string, password: string): Promise<{ userId: string }>;
  /** Log in via the real /auth/login endpoint and return the access token (Bearer). */
  login(email: string, password: string): Promise<string>;
  /** A fresh supertest request bound to the booted HTTP server. */
  http(): request.SuperTest<request.Test>;
  stop(): Promise<void>;
}

const OWNER_ROLE: RoleAssignment[] = [{ role: 'owner', locationScope: 'ALL' }];

/** A non-placeholder secret of the required strength (config rejects dictionary placeholders). */
function secret(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

function buildConfig(mongoUri: string): AppConfig {
  const storageRoot = mkdtempSync(join(tmpdir(), 'obikai-int-storage-'));
  return loadConfig({
    DEPLOY_MODE: 'self-host',
    TENANCY: 'multi',
    BASE_DOMAIN: 'localhost',
    AUTH_JWT_SECRET: secret(32),
    DATA_MASTER_KEY: secret(16),
    MONGO_URI: mongoUri,
    // Required by the schema; the API process never opens Redis (BullMQ is worker-only, rate-limit
    // uses an in-memory store), so a dummy URL is fine with no Redis running.
    REDIS_URL: 'redis://localhost:6379',
    STORAGE_PROVIDER: 'fs',
    FS_STORAGE_ROOT: storageRoot,
    STORAGE_PUBLIC_BASE_URL: 'http://localhost/files',
    EMAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'localhost',
  });
}

/** Boot a fresh app instance backed by its own in-memory MongoDB. Call `stop()` in afterAll. */
export async function bootTestApi(): Promise<TestApi> {
  const mongod = await MongoMemoryServer.create();
  const config = buildConfig(mongod.getUri());
  await connectMongo(config.mongoUri);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  const app = moduleRef.createNestApplication();
  // Mirror main.ts: structured errors. (helmet/rate-limit are edge concerns, unit-tested elsewhere.)
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const users = new UserRepository();
  const identities = new IdentityRepository();
  const memberships = new MembershipRepository();
  const tenants = new TenantRegistryRepository();

  async function seedTenantOwner(
    slug: string,
    email: string,
    password: string,
  ): Promise<{ userId: string }> {
    await tenants.ensureRegistered({ slug, name: slug });
    const user = await users.create({ email, emailVerified: true });
    await identities.create({
      userId: user.id,
      provider: 'local',
      email,
      passwordHash: hashPassword(password),
      emailVerified: true,
    });
    const context: TenantContext = {
      tenantId: slug,
      userId: user.id,
      sessionId: null,
      roles: OWNER_ROLE,
      memberId: null,
      requestId: `seed-${slug}`,
      tenancy: 'multi',
    };
    await runInTenantContext(context, async () => {
      await memberships.create({ userId: user.id, roles: OWNER_ROLE, status: 'active' });
    });
    return { userId: user.id };
  }

  async function login(email: string, password: string): Promise<string> {
    // /auth/* is excluded from the tenancy middleware (identity is tenant-global), so no Host needed.
    // Login is a POST that starts a session, so Nest returns 201 (its default @Post() status).
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return res.body.accessToken as string;
  }

  async function stop(): Promise<void> {
    await app.close();
    await disconnectMongo();
    await mongod.stop();
  }

  return {
    app,
    config,
    seedTenantOwner,
    login,
    http: () => request(app.getHttpServer()),
    stop,
  };
}
