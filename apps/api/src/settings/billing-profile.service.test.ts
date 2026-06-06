import type { AuthzActor } from '@obikai/authz';
import type { BillingProfileInput, TenantBillingProfile } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BillingProfileService,
  type BillingProfileStore,
  ForbiddenError,
} from './billing-profile.service.js';

/** In-memory fake store — unit-tests RBAC + service logic without Nest or Mongo. */
class FakeStore implements BillingProfileStore {
  current: TenantBillingProfile | null = null;

  async get(): Promise<TenantBillingProfile | null> {
    return this.current;
  }
  async upsert(input: BillingProfileInput): Promise<TenantBillingProfile> {
    const now = '2026-06-06T00:00:00.000Z';
    this.current = {
      id: 'bp1' as TenantBillingProfile['id'],
      tenantId: 't1' as TenantBillingProfile['tenantId'],
      legalName: input.legalName,
      vatId: input.vatId ?? null,
      registrationNumber: input.registrationNumber ?? null,
      addressLine1: input.addressLine1 ?? null,
      addressLine2: input.addressLine2 ?? null,
      postalCode: input.postalCode ?? null,
      city: input.city ?? null,
      country: input.country ?? null,
      email: input.email ?? null,
      paymentDetails: input.paymentDetails ?? null,
      footerNote: input.footerNote ?? null,
      createdAt: now,
      updatedAt: now,
    };
    return this.current;
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

const sample: BillingProfileInput = {
  legalName: 'Aikido Stockholm AB',
  vatId: 'SE556677889901',
  country: 'SE',
};

describe('BillingProfileService RBAC', () => {
  let svc: BillingProfileService;
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
    svc = new BillingProfileService(store);
  });

  it('returns null before a profile is configured', async () => {
    expect(await svc.get(owner)).toBeNull();
  });

  it('lets an owner upsert and read the profile', async () => {
    const saved = await svc.upsert(owner, sample);
    expect(saved.legalName).toBe('Aikido Stockholm AB');
    expect(saved.vatId).toBe('SE556677889901');
    expect((await svc.get(owner))?.legalName).toBe('Aikido Stockholm AB');
  });

  it('lets staff READ the profile but not edit it', async () => {
    await svc.upsert(owner, sample);
    expect((await svc.get(staff))?.legalName).toBe('Aikido Stockholm AB');
    await expect(svc.upsert(staff, sample)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forbids a member from reading or editing the profile', async () => {
    await expect(svc.get(member)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.upsert(member, sample)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
