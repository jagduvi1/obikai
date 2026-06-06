import type { AuthzActor } from '@obikai/authz';
import type { Location, LocationCreateInput, LocationUpdateInput } from '@obikai/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  LocationsService,
  type LocationsStore,
  NotFoundError,
} from './locations.service.js';

/** In-memory fake store — lets us unit-test RBAC + service logic without Nest or Mongo. */
class FakeStore implements LocationsStore {
  private readonly byId = new Map<string, Location>();
  private seq = 0;

  async create(input: LocationCreateInput): Promise<Location> {
    const id = `l${++this.seq}`;
    const now = '2026-06-06T00:00:00.000Z';
    const location: Location = {
      id: id as Location['id'],
      tenantId: 't1' as Location['tenantId'],
      name: input.name,
      timezone: input.timezone,
      address: input.address ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.byId.set(id, location);
    return location;
  }
  async findById(id: string): Promise<Location | null> {
    return this.byId.get(id) ?? null;
  }
  async list(): Promise<Location[]> {
    return [...this.byId.values()];
  }
  async update(id: string, patch: LocationUpdateInput): Promise<Location | null> {
    const cur = this.byId.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch } as Location;
    this.byId.set(id, next);
    return next;
  }
}

const actor = (over: Partial<AuthzActor> = {}): AuthzActor => ({
  userId: 'u1',
  roles: [],
  ...over,
});
// Only the owner role carries `location` permissions in DEFAULT_ROLE_PERMISSIONS (ADR-0004).
const owner = actor({ roles: [{ role: 'owner', locationScope: 'ALL' }] });
const staff = actor({ roles: [{ role: 'staff', locationScope: 'ALL' }] });

const sample: LocationCreateInput = { name: 'Dojo HQ', timezone: 'Europe/Stockholm' };

describe('LocationsService RBAC', () => {
  let svc: LocationsService;
  beforeEach(() => {
    svc = new LocationsService(new FakeStore());
  });

  it('lets an owner create and list locations', async () => {
    const created = await svc.create(owner, sample);
    expect(created.name).toBe('Dojo HQ');
    const list = await svc.list(owner);
    expect(list).toHaveLength(1);
  });

  it('forbids staff from creating, listing, reading, or updating locations', async () => {
    await expect(svc.create(staff, sample)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.list(staff)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.get(staff, 'l1')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.update(staff, 'l1', { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lets an owner read a location by id', async () => {
    const created = await svc.create(owner, sample);
    const got = await svc.get(owner, created.id);
    expect(got.id).toBe(created.id);
  });

  it('404s on a missing location', async () => {
    await expect(svc.get(owner, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lets an owner update a location', async () => {
    const created = await svc.create(owner, sample);
    const updated = await svc.update(owner, created.id, { timezone: 'Europe/Helsinki' });
    expect(updated.timezone).toBe('Europe/Helsinki');
  });

  it('404s when updating a missing location', async () => {
    await expect(svc.update(owner, 'nope', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });
});
