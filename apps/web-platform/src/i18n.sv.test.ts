import { describe, expect, it } from 'vitest';
import i18n from './i18n';

/** Flatten a nested catalog to dotted leaf keys (e.g. `tenant.activeMembers`). */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' ? flattenKeys(v as Record<string, unknown>, key) : [key];
  });
}

/**
 * Swedish is a first-class UI locale (invariant 6, Nordics-first). This guards against a silent English
 * fallback: every English key must have a Swedish counterpart. A failure here lists the untranslated
 * keys to fill in.
 */
describe('web-platform Swedish completeness', () => {
  it('translates every English UI key into Swedish', () => {
    const en = new Set(
      flattenKeys(i18n.getResourceBundle('en', 'translation') as Record<string, unknown>),
    );
    const sv = new Set(
      flattenKeys(i18n.getResourceBundle('sv', 'translation') as Record<string, unknown>),
    );
    const missing = [...en].filter((key) => !sv.has(key));
    expect(missing).toEqual([]);
  });
});
