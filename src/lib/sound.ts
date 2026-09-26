import type { FormState } from './form-state.ts'

/**
 * A short sound for every action, so the ear knows what happened before the
 * eye finds it: money in, money out, gone to the bin, back from it.
 *
 * SYNTHESISED, NOT FILES. Every sound is built at the moment it plays from a
 * few struck glass and wood tones, a click and a breath of air, in a short
 * room. Nothing to download, nothing to license, and the set stays one family
 * because it is one recipe.
 *
 * THE SUCCESS SOUND ONLY PLAYS ONCE THE SERVER SAID YES. A cash sound for a
 * payment that failed to save is worse than silence; a refusal gets its own
 * low note instead.
 */
export type Sound =
  | 'cashIn'
  | 'cashOut'
  | 'trash'
  | 'restore'
  | 'create'
  | 'save'
  | 'signIn'
  | 'signOut'
  | 'error'

/** Quiet on purpose: this is a phone in someone's hand, not a game. */
const VOLUME = 0.3
/** How much of each sound goes to the room. Enough to bloom, not to echo. */
const ROOM = 0.22
const MUTE_KEY = 'pondex:sound'

type Audio = { ctx: AudioContext; out: GainNode; room: GainNode }

let engine: Audio | null = null

/**
 * A short, dark room: two seconds of fading noise cut to under one. It is
 * the difference between a note that blooms and one that beeps, which is
 * most of what made the first set sound dated.
 */
function roomImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.ceil(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2)
  }
  return buffer
}

function audio(): Audio | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null
  if (!engine) {
    const ctx = new AudioContext()
    // Evens out the stacked voices so no sound jumps out louder than the rest.
    const limiter = ctx.createDynamicsCompressor()
    limiter.connect(ctx.destination)
    const out = ctx.createGain()
    out.gain.value = VOLUME
    out.connect(limiter)
    const room = ctx.createGain()
    room.gain.value = ROOM
    const reverb = ctx.createConvolver()
    reverb.buffer = roomImpulse(ctx, 0.9)
    const dark = ctx.createBiquadFilter()
    dark.type = 'lowpass'
    dark.frequency.value = 4500
    room.connect(reverb).connect(dark).connect(out)
    engine = { ctx, out, room }
  }
  if (engine.ctx.state === 'suspended') void engine.ctx.resume()
  return engine
}

/**
 * Phones only allow sound once a person has touched the page, and a server
 * action answers well after the tap that sent it. Waking the audio on the first
 * touch is what lets the answer be heard.
 */
if (typeof window !== 'undefined') {
  const wake = () => {
    audio()
    window.removeEventListener('pointerdown', wake)
    window.removeEventListener('keydown', wake)
  }
  window.addEventListener('pointerdown', wake)
  window.addEventListener('keydown', wake)
}

/* ---------- voices ---------- */

/** An envelope feeding both the dry path and the room. */
function voice(a: Audio, at: number, length: number, gain: number) {
  const start = a.ctx.currentTime + at
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(0.0001, start)
  env.gain.exponentialRampToValueAtTime(gain, start + 0.004)
  env.gain.exponentialRampToValueAtTime(0.0001, start + length)
  env.connect(a.out)
  env.connect(a.room)
  return { start, env }
}

/**
 * A sine lit by a partial that fades away. An inharmonic ratio (3.5) that
 * lingers reads as glass; a whole one (4) that dies almost at once, through
 * a warm filter, reads as wood.
 */
function struck(freq: number, at: number, length: number, gain: number, material: 'glass' | 'wood') {
  const a = audio()
  if (!a) return
  const { start, env } = voice(a, at, length, gain)
  const glass = material === 'glass'
  const carrier = a.ctx.createOscillator()
  const partial = a.ctx.createOscillator()
  const depth = a.ctx.createGain()
  carrier.frequency.value = freq
  partial.frequency.value = freq * (glass ? 3.5 : 4)
  depth.gain.setValueAtTime(freq * (glass ? 1.1 : 2.2), start)
  depth.gain.exponentialRampToValueAtTime(1, start + (glass ? length * 0.35 : 0.05))
  partial.connect(depth).connect(carrier.frequency)
  if (glass) {
    carrier.connect(env)
  } else {
    const warm = a.ctx.createBiquadFilter()
    warm.type = 'lowpass'
    warm.frequency.value = 2400
    carrier.connect(warm).connect(env)
  }
  for (const osc of [carrier, partial]) {
    osc.start(start)
    osc.stop(start + length + 0.05)
  }
}

const glass = (freq: number, at: number, length: number, gain: number) =>
  struck(freq, at, length, gain, 'glass')
const wood = (freq: number, at: number, length: number, gain: number) =>
  struck(freq, at, length, gain, 'wood')

function noise(a: Audio, at: number, length: number) {
  const start = a.ctx.currentTime + at
  const samples = Math.ceil(a.ctx.sampleRate * length)
  const buffer = a.ctx.createBuffer(1, samples, a.ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1
  const source = a.ctx.createBufferSource()
  source.buffer = buffer
  source.start(start)
  return { start, source }
}

/** A few milliseconds of click at the front: the "touch" in a modern UI sound. */
function tick(at: number, gain: number) {
  const a = audio()
  if (!a) return
  const { start, source } = noise(a, at, 0.012)
  const bright = a.ctx.createBiquadFilter()
  bright.type = 'highpass'
  bright.frequency.value = 3500
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(gain, start)
  env.gain.exponentialRampToValueAtTime(0.0001, start + 0.008)
  source.connect(bright).connect(env).connect(a.out)
}

/** Soft air, filtered dark and eased in and out, never a hiss. */
function air(at: number, length: number, from: number, to: number, gain: number) {
  const a = audio()
  if (!a) return
  const { start, source } = noise(a, at, length)
  const filter = a.ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.value = 0.8
  filter.frequency.setValueAtTime(from, start)
  filter.frequency.exponentialRampToValueAtTime(to, start + length)
  const env = a.ctx.createGain()
  env.gain.setValueAtTime(0.0001, start)
  env.gain.linearRampToValueAtTime(gain, start + length * 0.35)
  env.gain.linearRampToValueAtTime(0.0001, start + length)
  source.connect(filter).connect(env)
  env.connect(a.out)
  env.connect(a.room)
}

/** A pitch that sweeps fast, up for a bubble or down for a landing. */
function sweep(from: number, to: number, at: number, length: number, gain: number) {
  const a = audio()
  if (!a) return
  const { start, env } = voice(a, at, length, gain)
  const osc = a.ctx.createOscillator()
  osc.frequency.setValueAtTime(from, start)
  osc.frequency.exponentialRampToValueAtTime(to, start + length * 0.75)
  osc.connect(env)
  osc.start(start)
  osc.stop(start + length + 0.05)
}

const RECIPES: Record<Sound, () => void> = {
  // Two glass notes a fifth apart and a sparkle on top, the tap-to-pay "done".
  cashIn: () => {
    tick(0, 0.25)
    glass(1174.66, 0, 0.5, 0.55)
    glass(1760, 0.075, 0.7, 0.5)
    glass(2637, 0.15, 0.45, 0.14)
  },
  // Two soft wooden notes falling, riding a breath of air outwards.
  cashOut: () => {
    tick(0, 0.18)
    air(0, 0.16, 2200, 600, 0.12)
    wood(880, 0.01, 0.3, 0.55)
    wood(659.25, 0.085, 0.4, 0.5)
  },
  // A paper whoosh into the bin, then a soft tap as it lands.
  trash: () => {
    air(0, 0.2, 2600, 500, 0.3)
    tick(0.15, 0.2)
    sweep(150, 62, 0.15, 0.12, 0.6)
    wood(196, 0.15, 0.18, 0.25)
  },
  // Wooden notes rising into glass: it is back.
  restore: () => {
    tick(0, 0.18)
    wood(659.25, 0, 0.25, 0.45)
    wood(987.77, 0.07, 0.3, 0.45)
    glass(1318.51, 0.14, 0.55, 0.3)
  },
  // A round bubble pop, something new on the list.
  create: () => {
    tick(0, 0.2)
    sweep(360, 980, 0, 0.11, 0.6)
    glass(1567.98, 0.035, 0.28, 0.18)
  },
  // One crisp glass tick: saved.
  save: () => {
    tick(0, 0.3)
    glass(1760, 0, 0.22, 0.32)
  },
  // An open chord spelled upwards in glass.
  signIn: () => {
    ;[587.33, 880, 1318.51, 1479.98].forEach((freq, i) => glass(freq, i * 0.06, 1, 0.3))
  },
  signOut: () => {
    glass(880, 0, 0.6, 0.32)
    glass(587.33, 0.1, 0.9, 0.32)
  },
  // Two muted wooden knocks. Clear it did not work, without alarm.
  error: () => {
    wood(311.13, 0, 0.14, 0.6)
    wood(277.18, 0.1, 0.2, 0.6)
  },
}

export function play(sound: Sound) {
  // Announced before the mute check, so anything timed to a sound (the coin
  // animation) still runs when the Admin has sounds off.
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pondex:sound', { detail: sound }))
  if (isMuted()) return
  try {
    RECIPES[sound]()
  } catch {
    // A sound is a nicety. Nothing the admin is doing should fail because of one.
  }
}

/* ---------- mute ---------- */

const listeners = new Set<() => void>()

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'off'
  } catch {
    return false
  }
}

export function setMuted(muted: boolean) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, 'off')
    else localStorage.removeItem(MUTE_KEY)
  } catch {
    // Private windows can refuse storage; the switch then lasts until reload.
  }
  listeners.forEach((listener) => listener())
}

/** For useSyncExternalStore, so every copy of the switch shows the same thing. */
export function subscribeMuted(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* ---------- wiring to actions ---------- */

/**
 * The sound waiting on an action that answers by moving to another screen.
 *
 * Creating a loan, deleting one and signing in all redirect, and a redirect
 * never hands the result back to the caller. So the sound is armed before the
 * action goes, and SoundOnNavigate plays it when the new screen arrives, which
 * only happens when the action worked.
 *
 * It goes stale after a few seconds, so an action that failed in transit
 * cannot make a cash sound on some later, unrelated move.
 */
let armed: { sound: Sound; at: number } | null = null

export function playArmed() {
  if (armed && Date.now() - armed.at < 15_000) play(armed.sound)
  armed = null
}

/**
 * The action, with its sound attached.
 *
 * `sound` may read the form, for the one action whose sound depends on what was
 * chosen: money in or money out.
 */
export function withSound<State extends FormState>(
  action: (state: State, form: FormData) => Promise<State>,
  sound: Sound | ((form: FormData) => Sound),
): (state: State, form: FormData) => Promise<State> {
  return async (previous, form) => {
    const chosen = typeof sound === 'function' ? sound(form) : sound
    armed = { sound: chosen, at: Date.now() }
    const result = await action(previous, form)
    // Nothing back means it redirected; the armed sound plays on arrival.
    if (!result) return result
    armed = null
    play(result.error === null ? chosen : 'error')
    return result
  }
}
