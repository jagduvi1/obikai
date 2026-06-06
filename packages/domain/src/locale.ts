import { z } from 'zod';

/**
 * The five Phase-0 locales (invariant 6). This governs UI catalogs AND the keys of translatable
 * CONTENT data (rank/step/curriculum names) — see `LocalizedString`. The two i18n systems are
 * kept separate (ADR via @obikai/i18n): UI copy ships in catalogs; content data is embedded.
 */
export const LOCALES = ['sv', 'nb', 'da', 'fi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const localeSchema = z.enum(LOCALES);

/**
 * Translatable content data, embedded directly on the owning document (not a translation table)
 * so it snapshots cleanly into immutable rank-system versions. Not every locale need be present.
 */
export type LocalizedString = Partial<Record<Locale, string>>;

export const localizedStringSchema: z.ZodType<LocalizedString> = z
  .record(localeSchema, z.string())
  .refine((v) => Object.keys(v).length > 0, {
    message: 'LocalizedString must have at least one locale',
  });

export interface LocaleResolution {
  /** The tenant's authoring default, e.g. 'sv' for a Swedish dojo. */
  defaultLocale: Locale;
  /** The viewer's preferred locale. */
  requested: Locale;
}

/**
 * Deterministic fallback: requested → tenant default → 'en' → first present.
 * Never throws and never returns a raw key — the UI always renders real text.
 */
export function resolveLocalized(
  value: LocalizedString | undefined,
  ctx: LocaleResolution,
): string | undefined {
  if (!value) return undefined;
  const order: Locale[] = [ctx.requested, ctx.defaultLocale, DEFAULT_LOCALE];
  for (const loc of order) {
    const hit = value[loc];
    if (hit !== undefined) return hit;
  }
  for (const loc of LOCALES) {
    const hit = value[loc];
    if (hit !== undefined) return hit;
  }
  return undefined;
}
