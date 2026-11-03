'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PondexMascot, type MascotMood } from './pondex-mascot.tsx'

/**
 * Ask Pondex: the chat that lives on every signed-in screen.
 *
 * UI ONLY FOR NOW. Nothing here calls a server. The answers below are written
 * out by hand so the screens, the mascot's poses and the open/close and
 * full-screen motion can be judged before the AI behind them exists. When it
 * does, `answerFor` becomes a request and everything else stays.
 *
 * A launcher, not a sidebar item: the chat is a helper you call up over the page
 * you are on, so it opens on top of that page instead of replacing it. On a
 * phone the panel takes the whole screen; on a laptop it is a card in the
 * corner that can be made full screen.
 */

type Fact = { label: string; value: string }
type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'bot'; text: string; full: string; facts: Fact[]; done: boolean }

const SAMPLES: { q: string; keys: string[]; a: string; facts: Fact[] }[] = [
  {
    q: 'How much is out on loan right now?',
    keys: ['out on loan', 'how much is out', 'lent out'],
    a: '₱568,000.00 is out on loan right now, with 17 borrowers. Nobody is late.',
    facts: [
      { label: 'Out on loan', value: '₱568,000.00' },
      { label: 'Borrowers', value: '17' },
      { label: 'Overdue', value: '0' },
    ],
  },
  {
    q: 'Who funded Mitch G.’s loan due Oct 14?',
    keys: ['mitch', 'funded'],
    a: 'Three lenders funded it, ₱26,000.00 in all. It is fully paid, and ₱31,460.00 came back.',
    facts: [
      { label: 'John Ross Rivera', value: '₱14,990.00' },
      { label: 'Fidel Rivera', value: '₱7,710.00' },
      { label: 'Immanuel Rivera', value: '₱3,300.00' },
    ],
  },
  {
    q: 'What note is on Gladys A.’s Sep 28 loan?',
    keys: ['gladys', 'note'],
    a: 'The note says “4000 (interest) partial”. It looks like ₱4,000 of the interest was paid first. The loan is now fully paid.',
    facts: [
      { label: 'Loan', value: '₱20,000.00' },
      { label: 'Paid back', value: '₱25,600.00' },
      { label: 'Lender', value: 'Fidel Rivera' },
    ],
  },
  {
    q: 'What is Rina C.’s phone number?',
    keys: ['phone', 'address', 'number', 'contact'],
    a: 'I can’t share a borrower’s contact details. I can tell you about her loans and payments instead.',
    facts: [],
  },
]

function answerFor(question: string) {
  const q = question.toLowerCase()
  return (
    SAMPLES.find((s) => s.q.toLowerCase() === q) ??
    SAMPLES.find((s) => s.keys.some((k) => q.includes(k))) ?? {
      a: 'In this preview I can only answer the sample questions. Soon I will read your loans and notes to answer anything.',
      facts: [],
    }
  )
}

const THINK_MS = 1800
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

  function ask(question: string) {
    const q = question.trim()
    if (!q || thinking || writing) return
    const { a, facts } = answerFor(q)
    const id = nextId.current
    nextId.current += 2

    setDraft('')
    setThinking(true)
    setMessages((ms) => [...ms, { id, role: 'user', text: q }])

    timers.current.push(
      setTimeout(() => {
        setThinking(false)
        setMessages((ms) => [...ms, { id: id + 1, role: 'bot', text: '', full: a, facts, done: false }])
        let n = 0
        const tick = () => {
          n = Math.min(a.length, n + CHARS_PER_TICK)
          setMessages((ms) =>
            ms.map((m) => (m.id === id + 1 && m.role === 'bot' ? { ...m, text: a.slice(0, n), done: n >= a.length } : m)),
          )
          if (n < a.length) timers.current.push(setTimeout(tick, TYPE_MS))
        }
        timers.current.push(setTimeout(tick, 150))
      }, THINK_MS),
    )
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
                        key={s.q}
                        type="button"
                        onClick={() => ask(s.q)}
                        className="border-border bg-muted/40 hover:bg-accent hover:border-brand-line min-h-11 rounded-2xl border px-4 py-2.5 text-left text-sm"
                      >
                        {s.q}
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
                      <p className="text-sm leading-relaxed">
                        {m.text}
                        {!m.done && <span className="bg-brand animate-ask-caret ml-0.5 inline-block h-[1em] w-0.5 align-[-2px]" />}
                      </p>
                      {m.done && m.facts.length > 0 && (
                        <div className="animate-ask-rise border-border bg-muted/30 overflow-hidden rounded-2xl border">
                          {m.facts.map((f) => (
                            <div key={f.label} className="border-border/60 flex justify-between gap-5 border-t px-3.5 py-2.5 text-sm first:border-t-0">
                              <span className="text-muted-foreground">{f.label}</span>
                              <span className="font-semibold tabular-nums">{f.value}</span>
                            </div>
                          ))}
                        </div>
                      )}
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
                      key={s.q}
                      type="button"
                      onClick={() => ask(s.q)}
                      className="border-border hover:bg-accent min-h-10 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap"
                    >
                      {s.q}
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
                Preview with sample answers. Pondex can only read, never change your data.
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
