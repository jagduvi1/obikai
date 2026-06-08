import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveMigrationsDir } from './migrate.js';

/**
 * Guards the trickiest part of the migration runner: resolving the migrations dir bundled with
 * @obikai/db so it works both in dev and the deployed image. The end-to-end apply path is validated
 * against a real authenticated MongoDB (documented in the PR); this keeps the path logic from silently
 * breaking in CI.
 */
describe('resolveMigrationsDir', () => {
  it('points at @obikai/db’s migrations directory and it exists', () => {
    const dir = resolveMigrationsDir();
    expect(dir).toMatch(/[\\/]migrations$/);
    // The dir ships with @obikai/db (its package.json `files` includes "migrations").
    expect(existsSync(dir)).toBe(true);
  });
});
