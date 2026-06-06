/** A small discriminated Result type used by pure code (e.g. the rank engine) instead of throwing. */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export interface Instant {
  /** Milliseconds since the Unix epoch. The clock is always injected, never read ambiently. */
  readonly epochMs: number;
}
