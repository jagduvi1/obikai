/**
 * MessageLog repository tests (scope §4.8) against an in-memory MongoDB. Verifies per-broadcast and
 * per-member listing and tenant isolation. Rows are immutable (record + list only).
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MessageLogModel, MessageLogRepository } from '../src/message-log.js';
import { type TenantContext, runInTenantContext } from '../src/tenant-context.js';

const ctx = (tenantId: string): TenantContext => ({
  tenantId,
  userId: 'u1',
  sessionId: 's1',
  roles: [{ role: 'staff', locationScope: 'ALL' }],
  memberId: null,
  requestId: `req-${tenantId}`,
  tenancy: 'multi',
});

let mongod: MongoMemoryServer;
const repo = new MessageLogRepository();

const row = (broadcastId: string, memberId: string, over: Record<string, unknown> = {}) => ({
  broadcastId,
  memberId,
  channel: 'email' as const,
  category: 'transactional' as const,
  subject: 'Open mat',
  status: 'sent' as const,
  ...over,
});

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await MessageLogModel.syncIndexes();
}, 120_000);

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await mongoose.connection.collection('messagelogs').deleteMany({});
});

describe('MessageLogRepository', () => {
  it('records rows and lists them per broadcast and per member, tenant-scoped', async () => {
    await runInTenantContext(ctx('t1'), async () => {
      await repo.record(row('bc1', 'm1'));
      await repo.record(row('bc1', 'm2', { status: 'skipped_no_consent', category: 'marketing' }));
      await repo.record(row('bc2', 'm1', { status: 'failed', error: 'smtp down' }));
    });
    // Another tenant's row must not leak.
    await runInTenantContext(ctx('t2'), () => repo.record(row('bc1', 'm1')));

    const byBroadcast = await runInTenantContext(ctx('t1'), () => repo.listByBroadcast('bc1'));
    expect(byBroadcast.map((r) => r.memberId).sort()).toEqual(['m1', 'm2']);

    const byMember = await runInTenantContext(ctx('t1'), () => repo.listByMember('m1'));
    expect(byMember).toHaveLength(2); // bc1 (sent) + bc2 (failed), newest first
    expect(byMember[0]?.status).toBe('failed');
    expect(byMember[0]?.error).toBe('smtp down');
  });
});
