/**
 * @obikai/i18n — the platform's two-axis internationalization layer (ADR-0003).
 *
 *  1. UI catalogs: flat `key -> string` copy per `(locale, namespace)`, rendered with the tiny
 *     dependency-light `t` interpolator (apps swap in i18next for full ICU).
 *  2. Content data: translatable document fields (`LocalizedString`) with deterministic fallback,
 *     re-exported from @obikai/domain so callers have one i18n import.
 *
 * Plus `Intl`-backed `makeFormatters` (zero runtime deps) and the transport-friendly
 * `LocalizedAppError`. Currency follows the tenant; date/number follow the viewer (invariant 6).
 */
export { makeFormatters } from './formatters.js';
export type { FormatterContext, Formatters } from './formatters.js';

export { NAMESPACES, t } from './catalog.js';
export type { Catalog, Namespace, TVars } from './catalog.js';
export { resolveLocalized } from './catalog.js';
export type { LocaleResolution, LocalizedString } from './catalog.js';

export { localizedAppError } from './errors.js';
export type { I18nRef, LocalizedAppError } from './errors.js';
