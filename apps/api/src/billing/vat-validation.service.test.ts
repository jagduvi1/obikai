import type {
  VatCheckInput,
  VatCheckResult,
  VatValidationCapability,
  VatValidationPort,
} from '@obikai/adapter-contracts';
import type { AuthzActor } from '@obikai/authz';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, VatValidationService } from './vat-validation.service.js';

/** Fake port: records calls + returns a canned existence result. */
class FakePort implements VatValidationPort {
  readonly kind = 'vat' as const;
  readonly providerId = 'fake';
  readonly capabilities = new Set<VatValidationCapability>(['check']);
  calls: VatCheckInput[] = [];
  result: VatCheckResult = {
    status: 'valid',
    name: 'Aikido AB',
    address: null,
    requestIdentifier: 'REF1',
    checkedAt: '2026-06-07T10:00:00.000Z',
    source: 'fake',
  };
  init() {
    return Promise.resolve();
  }
  dispose() {
    return Promise.resolve();
  }
  health() {
    return Promise.resolve({ ok: true });
  }
  check(input: VatCheckInput): Promise<VatCheckResult> {
    this.calls.push(input);
    return Promise.resolve(this.result);
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });
const member = actor({ roles: [{ role: 'member', locationScope: 'ALL' }] });

describe('VatValidationService', () => {
  let port: FakePort;
  let svc: VatValidationService;
  beforeEach(() => {
    port = new FakePort();
    svc = new VatValidationService(port);
  });

  it('owner/staff: well-formed id → format ok + existence check (port called with split parts)', async () => {
    const r = await svc.validate(owner, 'SE556677889001');
    expect(r.format.ok).toBe(true);
    expect(r.check?.status).toBe('valid');
    expect(port.calls).toEqual([{ countryCode: 'SE', number: '556677889001' }]);
    // staff may also validate (tenantSettings:read).
    await svc.validate(staff, 'SE556677889001');
    expect(port.calls).toHaveLength(2);
  });

  it('malformed id → format reported, port NOT called (no pointless VIES hit)', async () => {
    const r = await svc.validate(owner, 'GB123456789');
    expect(r.format.ok).toBe(false);
    expect(r.format.reason).toBe('unsupported-country');
    expect(r.check).toBeNull();
    expect(port.calls).toHaveLength(0);
  });

  it('a member is forbidden', async () => {
    await expect(svc.validate(member, 'SE556677889001')).rejects.toBeInstanceOf(ForbiddenError);
    expect(port.calls).toHaveLength(0);
  });
});
