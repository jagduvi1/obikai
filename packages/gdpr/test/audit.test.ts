import { type TenantId, type UserId, brand } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import { type AuditLogEntry, appendEntry, hashChainEntry, verifyChain } from '../src/index.js';

const tenantId = brand<TenantId>('t1');
const actorId = brand<UserId>('u1');

function buildChain(): AuditLogEntry[] {
  const genesis = appendEntry(null, {
    tenantId,
    ts: 1,
    actorId,
    actorType: 'user',
    action: 'member.create',
    targetType: 'member',
    targetId: 'm1',
  });
  const second = appendEntry(genesis, {
    tenantId,
    ts: 2,
    actorId: null,
    actorType: 'system',
    action: 'member.update',
    targetType: 'member',
    targetId: 'm1',
    diff: { rank: 'changed' },
  });
  const third = appendEntry(second, {
    tenantId,
    ts: 3,
    actorId,
    actorType: 'user',
    action: 'gdpr.erase',
    targetType: 'member',
    targetId: 'm1',
    ip: '203.0.113.7',
  });
  return [genesis, second, third];
}

describe('audit hash chain', () => {
  it('genesis entry has a null prevHash and a stable, content-addressed hash', () => {
    const [genesis] = buildChain();
    expect(genesis?.prevHash).toBeNull();
    expect(genesis?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a freshly built chain verifies', () => {
    const chain = buildChain();
    expect(verifyChain(chain)).toEqual({ valid: true });
  });

  /**
   * Byte-stability guard (audit chain). The exact digest must NEVER change — an existing tenant's
   * append-only audit log would stop verifying. This pins the genesis hash for a fixed entry so a
   * dependency change (e.g. the @noble/hashes v1→v2 upgrade) that altered the output would fail CI. Do
   * NOT update this snapshot to make CI pass; a change means the upgrade is not byte-compatible.
   */
  it('hashChainEntry is byte-stable for a fixed genesis entry', () => {
    const hash = hashChainEntry(null, {
      tenantId,
      ts: 1,
      actorId,
      actorType: 'user',
      action: 'member.create',
      targetType: 'member',
      targetId: 'm1',
      prevHash: null,
    });
    expect(hash).toMatchInlineSnapshot(
      `"ec272427990e80d57229cd0e8948f35294239b10e349a030c9e644a0a3b71dd4"`,
    );
  });

  it('is deterministic: rebuilding produces identical hashes', () => {
    expect(buildChain().map((e) => e.hash)).toEqual(buildChain().map((e) => e.hash));
  });

  it('links each entry to its predecessor', () => {
    const [genesis, second, third] = buildChain();
    expect(second?.prevHash).toBe(genesis?.hash);
    expect(third?.prevHash).toBe(second?.hash);
  });

  it('tampering with an entry field breaks verifyChain at that index', () => {
    const chain = buildChain();
    const target = chain[1];
    if (target === undefined) throw new Error('fixture');
    // Mutate content WITHOUT recomputing the hash — simulates a covert edit.
    chain[1] = { ...target, action: 'member.delete' };
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.index).toBe(1);
      expect(result.reason).toBe('hash does not match entry content');
    }
  });

  it('deleting an entry breaks the prevHash link of the next entry', () => {
    const chain = buildChain();
    chain.splice(1, 1); // remove the middle entry
    const result = verifyChain(chain);
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect(result.index).toBe(1);
      expect(result.reason).toBe('prevHash does not link to predecessor');
    }
  });

  it('reordering entries breaks verification', () => {
    const [genesis, second, third] = buildChain();
    if (!genesis || !second || !third) throw new Error('fixture');
    const result = verifyChain([genesis, third, second]);
    expect(result.valid).toBe(false);
  });

  it('hashChainEntry folds prevHash in: same payload, different predecessor → different hash', () => {
    const [genesis] = buildChain();
    if (!genesis) throw new Error('fixture');
    const payload = {
      tenantId,
      ts: 2,
      actorId: null,
      actorType: 'system' as const,
      action: 'member.update',
      targetType: 'member',
      targetId: 'm1',
      diff: { rank: 'changed' },
    };
    const asLink = hashChainEntry(genesis, { ...payload, prevHash: genesis.hash });
    const asGenesis = hashChainEntry(null, { ...payload, prevHash: null });
    expect(asLink).not.toBe(asGenesis);
  });
});
