import type { PlatformGrant } from '@obikai/domain';
import { describe, expect, it } from 'vitest';
import { decidePlatformAccess } from './platform-access.js';

const grant = (role: PlatformGrant['role'] = 'platform_admin'): PlatformGrant =>
  ({
    id: 'pg1' as PlatformGrant['id'],
    userId: 'u1' as PlatformGrant['userId'],
    role,
    createdAt: '2026-06-07T00:00:00.000Z',
    updatedAt: '2026-06-07T00:00:00.000Z',
  }) as PlatformGrant;

describe('decidePlatformAccess', () => {
  it('rejects an unauthenticated request (no token claims) BEFORE any grant lookup', () => {
    expect(decidePlatformAccess(null, null)).toEqual({ kind: 'unauthenticated' });
    // Even if a grant somehow existed, no claims ⇒ unauthenticated (claims drive identity).
    expect(decidePlatformAccess(null, grant())).toEqual({ kind: 'unauthenticated' });
  });

  it('forbids an authenticated user with no platform grant', () => {
    expect(decidePlatformAccess({ userId: 'u1' }, null)).toEqual({ kind: 'forbidden' });
  });

  it('admits an authenticated user holding a grant, carrying their role', () => {
    expect(decidePlatformAccess({ userId: 'u1' }, grant())).toEqual({
      kind: 'ok',
      actor: { userId: 'u1', platformRole: 'platform_admin' },
    });
  });
});
