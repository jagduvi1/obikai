import { api } from '@obikai/api-client';
import type { Location, LocationCreateInput } from '@obikai/domain';

/**
 * Locations API binding (scope §4.10, ADR-0011). Physical dojo locations underpin scheduling: every
 * class schedule pins a location, and each location carries its own timezone for occurrence times.
 */
export function listLocations(): Promise<Location[]> {
  return api.get<Location[]>('/locations');
}

export function createLocation(input: LocationCreateInput): Promise<Location> {
  return api.post<Location>('/locations', input);
}
