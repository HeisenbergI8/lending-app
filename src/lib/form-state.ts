/**
 * What a form action answers with.
 *
 * In lib/ rather than beside the server helpers because BOTH sides need it: the
 * action produces one and the client component renders it. The dependency rule
 * for this app runs UI → Server → Domain, so a client component reaching into
 * src/server/ would point an arrow the wrong way — and src/server/ is meant to
 * be unreachable from the browser bundle, which is a promise worth keeping
 * literal rather than nearly true.
 *
 * A validation failure is an answer the form renders, not an exception. Throwing
 * would hand the admin Next's error screen and lose what they typed, which for
 * "you left the last name blank" is the wrong trade entirely.
 */
export type FormState = { error: string | null }

export const NO_ERROR: FormState = { error: null }

export function failed(message: string): FormState {
  return { error: message }
}
