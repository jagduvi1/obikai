import { describe, expect, it } from 'vitest';
import { type PlatformActor, canPlatform } from '../src/platform.js';

const admin: PlatformActor = { userId: 'u1', platformRole: 'platform_admin' };
const none: PlatformActor = { userId: 'u2', platformRole: null };

describe('canPlatform', () => {
  it('lets a platform_admin read/list every platform resource', () => {
    for (const resource of ['tenant', 'usage', 'auditLog'] as const) {
      for (const action of ['read', 'list'] as const) {
        expect(canPlatform(admin, { resource, action })).toBe(true);
      }
    }
  });

  it('denies a user with no platform role (no grant = no access)', () => {
    expect(canPlatform(none, { resource: 'tenant', action: 'list' })).toBe(false);
    expect(canPlatform(none, { resource: 'usage', action: 'read' })).toBe(false);
  });
});
