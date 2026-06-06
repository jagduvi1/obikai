/**
 * UI catalogs — the FIRST of the two i18n systems (the second is translatable CONTENT data,
 * `LocalizedString`, which is re-exported here from @obikai/domain). UI copy ships as flat
 * `key -> string` catalogs per `(locale, namespace)`; content data is embedded on its document.
 *
 * `t` is a deliberately tiny, dependency-light interpolator for `{var}` placeholders so any
 * package can render copy without a full i18n runtime. Apps wire i18next for full ICU
 * (plurals, gender, nesting); this default covers the simple substitution case only.
 */
export { resolveLocalized, type LocalizedString, type LocaleResolution } from '@obikai/domain';

/** The fixed set of UI catalog namespaces. One JSON catalog per `(locale, namespace)`. */
export type Namespace = 'common' | 'auth' | 'billing' | 'ranks' | 'errors' | 'email';

export const NAMESPACES: readonly Namespace[] = [
  'common',
  'auth',
  'billing',
  'ranks',
  'errors',
  'email',
] as const;

/** A loaded UI catalog: a flat map of dotted keys to display strings for one namespace/locale. */
export type Catalog = Record<string, string>;

/** Interpolation variables for `t`; values are coerced to strings at substitution time. */
export type TVars = Record<string, string | number>;

/**
 * Resolve `key` in `catalog` and substitute `{name}` placeholders from `vars`. Dependency-light
 * by design: no ICU, no plurals. A missing key returns the key itself (so the UI never renders
 * blank and missing copy is visible); an unmatched placeholder is left intact.
 */
export function t(catalog: Catalog, key: string, vars?: TVars): string {
  const template = catalog[key];
  if (template === undefined) return key;
  if (vars === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
