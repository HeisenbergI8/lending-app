'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PondexMascot, type MascotMood } from './pondex-mascot.tsx'

/**
 * Ask Pondex: the chat that lives on every signed-in screen.
 *
 * Each question goes to /api/assistant with the conversation so far. The
 * server picks which read-only lookups to run and sends back one answer, which
 * is then typed out here so the mascot can "talk" while it appears.
 *
 * A launcher, not a sidebar item: the chat is a helper you call up over the page
 * you are on, so it opens on top of that page instead of replacing it. On a
 * phone the panel takes the whole screen; on a laptop it is a card in the
 * corner that can be made full screen.
 */

type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'bot'; text: string; full: string; done: boolean; failed?: boolean }

/** Starters shown on an empty chat. Real questions, answered from real data. */
const SAMPLES = [
  'How much is out on loan right now?',
  'Who is overdue right now?',
  'How much is floating in each pot?',
  'What makes a borrower Good, Okay or Bad?',
]

async function fetchAnswer(history: { role: 'user' | 'assistant'; text: string }[]) {
  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history }),
    })
    const data = (await response.json()) as { ok: true; answer: string } | { ok: false; error: string }
    return data.ok ? { text: data.answer, failed: false } : { text: data.error, failed: true }
  } catch {
    return { text: 'Could not reach Pondex. Check your connection and try again.', failed: true }
  }
}

const TYPE_MS = 26
const CHARS_PER_TICK = 3

export function AskPondex() {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [poked, setPoked] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pokeTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const list = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  const writing = messages.some((m) => m.role === 'bot' && !m.done)
  const working: MascotMood = thinking ? 'think' : writing ? 'talk' : 'idle'
  const mood: MascotMood = poked ? 'happy' : working

  useEffect(() => {
    const all = [timers.current, pokeTimers.current]
    return () => all.forEach((ts) => ts.forEach(clearTimeout))
  }, [])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages, thinking])

  // The jump is a one-shot animation, so a second click has to take the class
  // off and put it back, or the browser sees no change and nothing plays.
  function poke() {
    pokeTimers.current.forEach(clearTimeout)
    setPoked(false)
    pokeTimers.current = [setTimeout(() => setPoked(true), 20), setTimeout(() => setPoked(false), 950)]
  }

  function toggleOpen() {
    if (open) {
      setOpen(false)
      setFull(false)
    } else {
      setOpen(true)
      poke()
    }
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || thinking || writing) return
    const id = nextId.current
    nextId.current += 2

    const history = [
      ...messages.filter((m) => !(m.role === 'bot' && m.failed)).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        text: m.role === 'user' ? m.text : m.full,
      })),
      { role: 'user' as const, text: q },
    ]

    setDraft('')
    setThinking(true)
    setMessages((ms) => [...ms, { id, role: 'user', text: q }])

    const { text: a, failed } = await fetchAnswer(history)
    setThinking(false)
    setMessages((ms) => [...ms, { id: id + 1, role: 'bot', text: '', full: a, done: false, failed }])
    let n = 0
    const tick = () => {
      n = Math.min(a.length, n + CHARS_PER_TICK)
      setMessages((ms) =>
        ms.map((m) => (m.id === id + 1 && m.role === 'bot' ? { ...m, text: a.slice(0, n), done: n >= a.length } : m)),
      )
      if (n < a.length) timers.current.push(setTimeout(tick, TYPE_MS))
    }
    timers.current.push(setTimeout(tick, 150))
  }

  const empty = messages.length === 0 && !thinking

  return (
    <>
      {open && full && (
        <button
          type="button"
          aria-label="Exit full screen"
          onClick={() => setFull(false)}
          className="animate-ask-fade fixed inset-0 z-50 hidden cursor-default bg-black/40 md:block"
        />
      )}

      {open && (
        <section
          aria-label="Ask Pondex"
          className={cn(
            'animate-ask-open bg-card text-card-foreground fixed inset-0 z-50 flex flex-col overflow-hidden transition-all duration-300',
            'md:border-border md:origin-bottom-right md:rounded-3xl md:border md:shadow-2xl',
            full
              ? 'md:inset-6'
              : 'md:inset-auto md:right-6 md:bottom-36 md:h-[min(660px,calc(100dvh-11rem))] md:w-[410px]',
          )}
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className={cn('flex min-h-0 w-full flex-1 flex-col', full && 'md:mx-auto md:max-w-3xl')}>
            <header className="border-border/70 flex items-center gap-3 border-b py-3 pr-2 pl-4">
              <button type="button" onClick={poke} aria-label="Say hi to Pondex" className="rounded-2xl">
                <PondexMascot mood={mood} size={52} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">Pondex</p>
                <p className="text-muted-foreground truncate text-xs">
                  {thinking ? 'Looking through your loans…' : writing ? 'Writing an answer…' : 'Answers from your loans'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFull((f) => !f)}
                aria-label={full ? 'Exit full screen' : 'Full screen'}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground hidden size-11 items-center justify-center rounded-xl md:flex"
              >
                {full ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
              </button>
              <button
                type="button"
                onClick={toggleOpen}
                aria-label="Close chat"
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex size-11 items-center justify-center rounded-xl"
              >
                <ChevronDown className="size-5" />
              </button>
            </header>

            <div ref={list} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
              {empty && (
                <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
                  <button type="button" onClick={poke} aria-label="Say hi to Pondex" className="rounded-3xl">
                    <PondexMascot mood={poked ? 'happy' : 'idle'} size={160} />
                  </button>
                  <h2 className="text-xl font-semibold">Hi, I’m Pondex.</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    I read your loans, payments and notes, and answer in plain words. I can only look, never change
                    anything.
                  </p>
                  <div className="mt-1 flex w-full flex-col gap-2">
                    {SAMPLES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        className="border-border bg-muted/40 hover:bg-accent hover:border-brand-line min-h-11 rounded-2xl border px-4 py-2.5 text-left text-sm"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) =>
                m.role === 'user' ? (
                  <div
                    key={m.id}
                    className="animate-ask-rise bg-brand text-brand-foreground max-w-[82%] self-end rounded-[18px_18px_4px_18px] px-4 py-2.5 text-sm leading-relaxed"
                  >
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} className="animate-ask-rise flex max-w-[94%] items-start gap-2.5">
                    <PondexMascot mood={m.done ? 'idle' : 'talk'} size={46} className="shrink-0" />
                    <div className="flex min-w-0 flex-col gap-2.5 pt-2.5">
                      <p className={cn('text-sm leading-relaxed whitespace-pre-line', m.failed && 'text-muted-foreground')}>
                        {m.text}
                        {!m.done && <span className="bg-brand animate-ask-caret ml-0.5 inline-block h-[1em] w-0.5 align-[-2px]" />}
                      </p>
                    </div>
                  </div>
                ),
              )}

              {thinking && (
                <div className="animate-ask-rise flex items-center gap-2.5">
                  <PondexMascot mood="think" size={62} />
                  <span className="text-muted-foreground text-sm">Thinking</span>
                  <span className="flex gap-1">
                    <span className="bg-brand animate-ask-dot size-1.5 rounded-full" />
                    <span className="bg-brand animate-ask-dot size-1.5 rounded-full [animation-delay:.18s]" />
                    <span className="bg-brand animate-ask-dot size-1.5 rounded-full [animation-delay:.36s]" />
                  </span>
                </div>
              )}
            </div>

            <div className="border-border/70 flex flex-col gap-2.5 border-t px-3 pt-2.5 pb-3">
              {!empty && (
                <div className="flex gap-2 overflow-x-auto pb-0.5">
                  {SAMPLES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="border-border hover:bg-accent min-h-10 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  ask(draft)
                }}
                className="border-border focus-within:border-brand focus-within:ring-brand/20 flex items-center gap-2 rounded-2xl border py-1.5 pr-1.5 pl-4 focus-within:ring-3"
              >
                <label htmlFor="ask-pondex-input" className="sr-only">
                  Ask Pondex a question
                </label>
                <input
                  id="ask-pondex-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Ask about a loan or a borrower…"
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none md:text-sm"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  className="bg-brand text-brand-foreground hover:bg-brand-strong flex size-11 shrink-0 items-center justify-center rounded-xl"
                >
                  <ArrowUp className="size-5" />
                </button>
              </form>
              <p className="text-muted-foreground text-center text-[11px]">
                Pondex can only read, never change your data. Check important numbers in the app.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Above the phone tab bar on a phone, in the corner on a laptop. Hidden on a
          phone while the chat is open, since the panel covers the screen. */}
      <div
        className={cn(
          'fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-40 flex items-center gap-3 md:right-6 md:bottom-6',
          open && 'hidden md:flex',
        )}
      >
        {!open && (
          <div className="animate-ask-bubble bg-card border-border hidden rounded-[16px_16px_4px_16px] border px-3.5 py-2.5 text-sm whitespace-nowrap shadow-lg sm:block">
            Hi! Ask me about your loans.
          </div>
        )}
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={open ? 'Close Ask Pondex' : 'Open Ask Pondex'}
          aria-expanded={open}
          className="rounded-3xl drop-shadow-xl transition-transform hover:-translate-y-0.5 hover:scale-105"
        >
          <PondexMascot mood={mood} size={84} />
        </button>
      </div>
    </>
  )
}
