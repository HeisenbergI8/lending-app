/**
 * A validation outcome that the caller must look at.
 *
 * Money rules fail for reasons a person can fix — a due date that is not a whole
 * number of weeks, fundings that do not add up to the capital. Those are not
 * exceptions; they are answers, and the form needs to render them. Throwing would
 * push that into a try/catch at every call site and invite someone to swallow it.
 *
 * Genuine programming errors (a negative number of weeks reaching the maths) still
 * throw, because there is no sensible thing to show a user.
 */
export type Ok<T> = { ok: true; value: T }
export type Err<E> = { ok: false; error: E }
export type Result<T, E> = Ok<T> | Err<E>

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}
