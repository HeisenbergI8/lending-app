import { EXAMPLES, type Intent } from '../../lib/command/intents.ts'

/**
 * The meaning-matcher: a small free AI model (all-MiniLM-L6-v2, about 23 MB)
 * that runs on this server, no API and no daily limit. It turns a sentence
 * into a list of numbers that stands for its meaning (an "embedding"), so two
 * sentences that mean the same thing land close together even when they share
 * no words: "can you front Rico 10k" lands next to "lend Rico 10k".
 *
 * It only says WHICH action a sentence is closest to. The rules then read the
 * names and amounts, and the Admin confirms the card. When it is not clearly
 * sure, it says nothing and the big AI answers instead.
 *
 * Loaded once per server instance (about 2 seconds the first time, then a few
 * milliseconds a sentence). If it cannot load, the rules alone are used.
 */

const MODEL = 'Xenova/all-MiniLM-L6-v2'

/** Names in the example sentences. Names carry no meaning about the action, so they are hidden on both sides. */
const EXAMPLE_NAMES = ['rico', 'lyn', 'angel', 'dan', 'bea', 'maria', 'jun', 'juan', 'ana', 'mark', 'paolo', 'ben', 'santos', 'cruz', 'reyes', 'dela']

/** The sentence with people's names replaced by "someone", so only the action is compared. */
export function withoutNames(text: string, names: string[] = []): string {
  const all = new Set([...EXAMPLE_NAMES, ...names.map((n) => n.toLowerCase()).filter((n) => n.length > 1)])
  return text.replace(/[\p{L}']+/gu, (w) => (all.has(w.toLowerCase().replace(/'s$/, '')) ? 'someone' : w))
}
/** How close a sentence must be to an example, 0 to 1. Below this, it is not sure. */
export const SURE = 0.6
/** How far ahead of the next action the best one must be. */
export const MARGIN = 0.07

type Embedder = (texts: string[]) => Promise<number[][]>
type Example = { intent: string; vector: number[] }

let loading: Promise<{ embed: Embedder; examples: Example[] } | null> | null = null

async function load() {
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    // A deployed server can only write to /tmp; the model is fetched there once per instance.
    if (process.env.VERCEL) env.cacheDir = '/tmp/hf-models'
    const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    const embed: Embedder = async (texts) => (await extractor(texts, { pooling: 'mean', normalize: true })).tolist() as number[][]
    const flat = Object.entries(EXAMPLES).flatMap(([intent, sentences]) => sentences.map((s) => ({ intent, s })))
    const vectors = await embed(flat.map((f) => withoutNames(f.s)))
    return { embed, examples: flat.map((f, i) => ({ intent: f.intent, vector: vectors[i] })) }
  } catch (error) {
    console.error('[dex-e meaning] could not load the model; rules only', error)
    return null
  }
}

/** Starts loading early, so the first message that needs it does not wait as long. */
export function warmUp(): void {
  loading ??= load()
}

const dot = (a: number[], b: number[]) => a.reduce((sum, x, i) => sum + x * b[i], 0)

export type Meaning = { intent: Intent | 'delete_any' | 'restore_any' | 'question'; score: number; runnerUp: number }

/**
 * The action a sentence means, when the model is clearly sure; null when it is
 * not, or when the model is not ready within `waitMs`.
 */
export async function meaningOf(text: string, names: string[] = [], waitMs = 6000): Promise<Meaning | null> {
  warmUp()
  const ready = await Promise.race([loading, new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))])
  if (!ready) return null
  const [vector] = await ready.embed([withoutNames(text, names)])
  // Best score per action, then the best action and how far ahead of the next one it is.
  const best = new Map<string, number>()
  for (const ex of ready.examples) best.set(ex.intent, Math.max(best.get(ex.intent) ?? -1, dot(vector, ex.vector)))
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1])
  const [top, next] = ranked
  if (!top || top[1] < SURE || top[1] - (next?.[1] ?? 0) < MARGIN) return null
  return { intent: top[0] as Meaning['intent'], score: top[1], runnerUp: next?.[1] ?? 0 }
}

/** A sentence's meaning as numbers (unit length, so a dot product is the closeness), or null when the model is not ready. */
export async function embed(text: string, waitMs = 6000): Promise<number[] | null> {
  warmUp()
  const ready = await Promise.race([loading, new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs))])
  if (!ready) return null
  const [vector] = await ready.embed([text])
  return vector
}

export const closeness = dot
