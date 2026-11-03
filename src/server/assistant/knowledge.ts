import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The retrieval half of Ask Pondex: find the parts of the rules file that fit a
 * question, instead of sending the whole file with every question.
 *
 * The free Groq plan allows about 8,000 tokens a minute, and the whole file is
 * thousands of them on EVERY call the model makes. A question about a number
 * never needs it; a question about a word needs one or two sections.
 *
 * KEYWORD MATCHING, NOT EMBEDDINGS, on purpose. The file is about twenty short
 * sections, each with an `Also called:` line naming the words people actually
 * use for it. Keyword search wins on exact terms ("7%", "GCash") and can say why
 * a section matched; synonyms are what the alias line is for. Embeddings become
 * worth it when the sections number in the hundreds.
 *
 * Scoring: a word in the title, an alias or a **bold label** counts 3, a word in
 * the body counts 1. Sections far below the best match are dropped, so a
 * question does not drag in a half-related section the model then leans on.
 */

const FILE = 'ai/knowledge/pondex-rules.md'
const MAX_SECTIONS = 3
/** A section must score at least this share of the best one to be returned. */
const MIN_SHARE = 0.4

export type Section = { title: string; text: string; strong: Set<string>; body: Set<string> }

const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'what', 'how', 'does', 'did', 'is', 'can', 'who', 'when', 'why',
  'with', 'from', 'that', 'this', 'an', 'of', 'to', 'in', 'on', 'my', 'do', 'it', 'be', 'or', 'if',
  'there', 'about', 'me', 'pondex',
])

/** Lower case, no stop words, and a plural folded so "rates" finds "rate". */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

export function parseSections(file: string): Section[] {
  return file
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [heading, ...lines] = chunk.split('\n')
      const title = heading.trim()
      // The alias line may wrap onto following lines, up to the first blank line.
      const blank = lines.findIndex((line) => line.trim() === '')
      const aliasLines = lines[0]?.startsWith('Also called:') ? lines.slice(0, blank === -1 ? 1 : blank) : []
      const text = lines
        .slice(aliasLines.length)
        .join('\n')
        .replace(/\n---\s*$/, '')
        .trim()
      const aliases = aliasLines.join(' ').replace('Also called:', '')
      const labels = [...text.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]).join(' ')
      return {
        title,
        text,
        strong: new Set(tokens(`${title} ${aliases} ${labels}`)),
        body: new Set(tokens(text)),
      }
    })
}

let sections: Section[] | null = null

/** Read once per server instance. Traced into the deploy by next.config.ts. */
function load(): Section[] {
  sections ??= parseSections(readFileSync(path.join(process.cwd(), FILE), 'utf8'))
  return sections
}

export function rankSections(all: Section[], question: string): Section[] {
  const asked = [...new Set(tokens(question))]
  const scored = all
    .map((section) => ({
      section,
      score: asked.reduce((n, w) => n + (section.strong.has(w) ? 3 : 0) + (section.body.has(w) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)

  const best = scored[0]?.score ?? 0
  return scored
    .filter((x) => x.score >= best * MIN_SHARE)
    .slice(0, MAX_SECTIONS)
    .map((x) => x.section)
}

/** The best few sections for a question, each with its source, or the topic list when nothing fits. */
export function readRules(question: string) {
  const all = load()
  const ranked = rankSections(all, question)

  if (ranked.length === 0) {
    return { found: false, note: 'Nothing in the rules matches. Say the rules do not cover it.', topics: all.map((s) => s.title) }
  }
  return {
    found: true,
    sections: ranked.map((section) => ({ source: `Pondex rules › ${section.title}`, text: section.text })),
  }
}
