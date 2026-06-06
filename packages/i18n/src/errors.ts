/**
 * A transport-friendly application error that separates the STABLE machine code (which clients
 * branch on and which never changes) from the LOCALIZED message (resolved against a UI catalog at
 * the edge). The error itself carries no rendered text — only the `{ns, key, vars}` needed to
 * render it in the viewer's locale via `t`, plus the HTTP status the API should map it to.
 */
import type { Namespace, TVars } from './catalog.js';

/** Where the human-readable message lives in the UI catalogs (resolved with `t` at render time). */
export interface I18nRef {
  readonly ns: Namespace;
  readonly key: string;
  /** Placeholder values for the catalog template; omitted entirely when the message has none. */
  readonly vars?: TVars;
}

/**
 * The serializable error shape. `code` is the contract clients depend on (e.g.
 * 'AUTH_INVALID_CREDENTIALS'); `i18n` is presentation; `httpStatus` is the wire mapping.
 */
export interface LocalizedAppError {
  /** Stable, screaming-snake-case machine code. Part of the API contract — never localize this. */
  readonly code: string;
  /** Catalog coordinates used to render the user-facing message. */
  readonly i18n: I18nRef;
  /** The HTTP status code the API layer should respond with. */
  readonly httpStatus: number;
}

/**
 * Build a {@link LocalizedAppError}, omitting `vars` when none are supplied so the result stays
 * clean under `exactOptionalPropertyTypes` (never an explicit `undefined`).
 */
export function localizedAppError(
  code: string,
  i18n: { ns: Namespace; key: string; vars?: TVars },
  httpStatus: number,
): LocalizedAppError {
  const ref: I18nRef =
    i18n.vars !== undefined
      ? { ns: i18n.ns, key: i18n.key, vars: i18n.vars }
      : { ns: i18n.ns, key: i18n.key };
  return { code, i18n: ref, httpStatus };
}
