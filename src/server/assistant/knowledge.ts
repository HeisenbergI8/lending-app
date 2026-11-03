import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * The retrieval half of Ask Pondex: find the parts of the rules file that fit a
 * question, instead of sending the whole file with every question.
 *
 * The free Groq plan allows about 8,000 tokens a minute, and the whole file is
 * about 2,000 of them on EVERY call the model makes. A question about a number
 * never needs it; a question about a word needs one or two sections.
 *
 * The file is already written as stand-alone `## ` sections, so a section is the
 * unit returned. Matching is plain word overlap, with the title and any **bold
 * label** counted triple, so "usual loan length" finds the Admin's own rule.
 * That is enough for a file this size; embeddings and a vector store become
 * worth it when there are hundreds of sections, not twenty.
 */

type Section = { title: string; body: string; words: Set<string>; titleWords: Set<string> }

const STOP = new Set(['the', 'and', 'for', 'are', 'what', 'how', 'does', 'is', 'can', 'who', 'when', 'why', 'with', 'from', 'that', 'this', 'a', 'an', 'of', 'to', 'in', 'on', 'my', 'do'])

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

let sections: Section[] | null = null

/** Read once per server instance. Traced into the deploy by next.config.ts. */
function load(): Section[] {
  if (sections) return sections
  const file = readFileSync(path.join(process.cwd(), 'ai/knowledge/pondex-rules.md'), 'utf8')
  sections = file
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [title, ...rest] = chunk.split('\n')
      const body = rest.join('\n').replace(/\n---\s*$/, '').trim()
      const labels = [...body.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]).join(' ')
      return { title: title.trim(), body, words: new Set(tokens(body)), titleWords: new Set(tokens(`${title} ${labels}`)) }
    })
  return sections
}

/** The best few sections for a question, or the list of titles when nothing fits. */
export function readRules(question: string) {
  const all = load()
  const asked = tokens(question)
  const scored = all
    .map((s) => ({
      s,
      score: asked.reduce((n, w) => n + (s.titleWords.has(w) ? 3 : 0) + (s.words.has(w) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  if (scored.length === 0) return { found: false, sectionTitles: all.map((s) => s.title) }
  return { found: true, sections: scored.map(({ s }) => ({ title: s.title, text: s.body })) }
}
