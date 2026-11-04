'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, ChevronDown, Hourglass, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clock, manilaTime, modelLines, type Status, statusLine } from '@/lib/assistant-status'
import { ActionCard, type CardStatus, type ProposalView } from './action-card.tsx'
import { PondexMascot, type MascotMood } from './pondex-mascot.tsx'
import { DoneSteps, LiveSteps, WRITING_STEP } from './step-list.tsx'
import type { Step } from '@/lib/assistant-steps'

/**
 * Dex-E: the chat that lives on every signed-in screen.
 *
 * Each question goes to /api/assistant with the conversation so far. The
 * server picks which lookups to run, tells the chat about each one as it goes
 * (shown live under "Thinking", then folded above the answer), and sends back
 * one answer, which is then typed out here so the mascot can "talk" while it appears. When the answer is
 * a change, it comes with a card the Admin confirms (see action-card.tsx).
 *
 * The header says whether Pondex can answer now and which model will (see
 * lib/assistant-status.ts); tapping it shows Groq's own figures per model.
 * When every model is resting, the input is locked and a countdown says when
 * Pondex is back, instead of letting a question fail.
 *
 * A launcher, not a sidebar item: the chat is a helper you call up over the page
 * you are on, so it opens on top of that page instead of replacing it. On a
 * phone the panel takes the whole screen; on a laptop it is a card in the
 * corner that can be made full screen.
 */

type Card = { proposal: ProposalView; status: CardStatus; error: string | null }
type Message =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'bot'; text: string; full: string; done: boolean; failed?: boolean; card?: Card; steps?: Step[]; thoughtMs?: number }

/** Today's allowance, from /api/assistant. coolUntil is when a model is free again, or null. */
type ModelFigures = {
  model: string
  used: number
  limit: number
  exact: boolean
  coolUntil: string | null
  requestsLeft: number | null
  requestLimit: number | null
  minuteTokensLeft: number | null
}
type Usage = { status: Status; inUse: string | null; coolUntil: string | null; local?: boolean; models: ModelFigures[] }

/** Starters shown on an empty chat. Real questions, answered from real data. */
const SAMPLES = [
  'How much is out on loan right now?',
  'Who is overdue right now?',
  'How much is floating in each pot?',
  'What makes a borrower Good, Okay or Bad?',
]

type Answer = { text: string; failed: boolean; proposal: ProposalView | null; usage: Usage | null; thoughtMs: number }

type Reply = { ok: true; answer: string; proposal: ProposalView | null; usage: Usage } | { ok: false; error: string; usage: Usage | null }

/** Asks, reading the steps as they arrive (one JSON line each) and the answer last. */
async function fetchAnswer(history: { role: 'user' | 'assistant'; text: string }[], onStep: (step: Step) => void): Promise<Answer> {
  const started = Date.now()
  const took = () => Date.now() - started
  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, stream: true }),
    })
    let data: Reply | null = null
    if (!response.body || !response.headers.get('content-type')?.includes('ndjson')) {
      // Refusals (signed out, bad request) come back as plain JSON.
      data = (await response.json()) as Reply
    } else {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value, { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line) as { type: 'step'; step: Step } | { type: 'result'; result: Reply }
          if (event.type === 'step') onStep(event.step)
          else data = event.result
        }
        if (done) break
      }
    }
    if (!data) throw new Error('No answer')
    return data.ok
      ? { text: data.answer, failed: false, proposal: data.proposal, usage: data.usage, thoughtMs: took() }
      : { text: data.error, failed: true, proposal: null, usage: data.usage, thoughtMs: took() }
  } catch {
    return { text: 'Could not reach Pondex. Check your connection and try again.', failed: true, proposal: null, usage: null, thoughtMs: took() }
  }
}

/** What the model is told about a card, so the next question knows whether it was saved. */
function cardNote(card: Card): string {
  const what = `I proposed: ${card.proposal.title} (${card.proposal.lines.map((l) => `${l.label} ${l.value}`).join(', ')}).`
  if (card.status === 'done') return `${what} The Admin confirmed it and it was saved.`
  if (card.status === 'cancelled') return `${what} The Admin cancelled it; nothing was saved.`
  if (card.status === 'replaced') return `${what} A newer card replaced it; nothing was saved from this one.`
  if (card.status === 'failed') return `${what} It was not saved: ${card.error}`
  return `${what} Not confirmed yet.`
}


const TYPE_MS = 26
const CHARS_PER_TICK = 3

export function AskPondex() {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [liveSteps, setLiveSteps] = useState<Step[]>([])
  const [poked, setPoked] = useState(false)
  const [draft, setDraft] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const pokeTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const list = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)
  const router = useRouter()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [details, setDetails] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const coolMs = usage?.coolUntil ? new Date(usage.coolUntil).getTime() - now : 0
  const resting = coolMs > 0

  const loadUsage = useCallback(async () => {
    try {
      const response = await fetch('/api/assistant')
      if (response.ok) {
        setUsage((await response.json()) as Usage)
        setNow(Date.now())
      }
    } catch {
      // The counter is a nicety; a failed fetch leaves the chat usable.
    }
  }, [])

  // The countdown ticks only while there is one, and asks again the moment it ends.
  useEffect(() => {
    if (!usage?.coolUntil) return
    const timer = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (new Date(usage.coolUntil!).getTime() <= t) {
        clearInterval(timer)
        void loadUsage()
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [usage?.coolUntil, loadUsage])

  const writing = messages.some((m) => m.role === 'bot' && !m.done)
  // The header and the open button stay still; only the face beside the answer thinks or talks.
  const mood: MascotMood = poked ? 'happy' : 'idle'

  useEffect(() => {
    const all = [timers.current, pokeTimers.current]
    return () => all.forEach((ts) => ts.forEach(clearTimeout))
  }, [])

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [messages, thinking, liveSteps])

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
      // Fresh figures each time the chat opens.
      void loadUsage()
    }
  }

  function setCard(messageId: number, status: CardStatus, error: string | null) {
    setMessages((ms) =>
      ms.map((m) => (m.id === messageId && m.role === 'bot' && m.card ? { ...m, card: { ...m.card, status, error } } : m)),
    )
    // The page behind the chat shows the old figures until it is re-rendered.
    if (status === 'done') router.refresh()
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || thinking || writing || resting) return
    const id = nextId.current
    nextId.current += 2

    const history = [
      ...messages.filter((m) => !(m.role === 'bot' && m.failed)).map((m) => ({
        role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
        text: m.role === 'user' ? m.text : m.card ? cardNote(m.card) : m.full,
      })),
      { role: 'user' as const, text: q },
    ]

    setDraft('')
    setThinking(true)
    setLiveSteps([])
    setMessages((ms) => [...ms, { id, role: 'user', text: q }])

    // A step comes twice: once as it starts, again when it is back.
    let steps: Step[] = []
    const { text: a, failed, proposal, usage: latest, thoughtMs } = await fetchAnswer(history, (step) => {
      steps = steps.some((s) => s.id === step.id) ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, step]
      setLiveSteps(steps)
    })
    setThinking(false)
    setLiveSteps([])
    // The countdown corrects its clock on its first tick, a second from now.
    if (latest) setUsage(latest)
    const card: Card | undefined = proposal ? { proposal, status: 'ready', error: null } : undefined
    setMessages((ms) => [
      // A new card retires every older one still waiting, so "actually make it
      // 6k" cannot leave the 5k card confirmable alongside it.
      ...(card
        ? ms.map((m) =>
            m.role === 'bot' && m.card && (m.card.status === 'ready' || m.card.status === 'failed')
              ? { ...m, card: { ...m.card, status: 'replaced' as const } }
              : m,
          )
        : ms),
      { id: id + 1, role: 'bot', text: '', full: a, done: false, failed, card, steps: steps.filter((s) => s.state !== 'doing'), thoughtMs },
    ])
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
          aria-label="Dex-E"
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
              <button type="button" onClick={poke} aria-label="Say hi to Dex-E" className="cursor-pointer rounded-2xl">
                <PondexMascot mood={mood} size={52} />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">Dex-E</p>
                <button
                  type="button"
                  onClick={() => {
                    setNow(Date.now())
                    setDetails((d) => !d)
                  }}
                  disabled={!usage || usage.local}
                  aria-expanded={details}
                  aria-label={usage && !usage.local ? `${statusLine(usage, now)}. ${details ? 'Hide' : 'Show'} AI used today` : undefined}
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-brand/40 group flex max-w-full cursor-pointer items-center gap-1 rounded text-left text-xs outline-none focus-visible:ring-2 disabled:cursor-default disabled:hover:text-muted-foreground"
                >
                  <span className="truncate">
                    {thinking
                      ? `${liveSteps.findLast((s) => s.state === 'doing')?.text ?? (liveSteps.length > 0 ? WRITING_STEP : 'Looking through your loans')}…`
                      : writing
                        ? 'Writing an answer…'
                        : usage
                          ? statusLine(usage, now)
                          : 'Answers from your loans'}
                  </span>
                  {usage && !usage.local && (
                    <ChevronDown aria-hidden className={cn('size-3.5 shrink-0 transition-transform duration-200', details && 'rotate-180')} />
                  )}
                </button>
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

            {details && usage && !usage.local && (
              <div className="border-border/70 bg-muted/40 border-b px-4 py-3">
                <p className="text-muted-foreground mb-3 text-xs">Free AI used today. When one is used up, the next one answers.</p>
                <ul className="flex flex-col gap-3">
                  {modelLines(usage, now).map((line) => (
                    <li key={line.model} title={line.model}>
                      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                        <span className="font-medium">{line.name}</span>
                        <span className="text-muted-foreground text-xs">{line.note}</span>
                      </div>
                      <div className="bg-border/70 h-1.5 overflow-hidden rounded-full" role="meter" aria-label={`${line.name} used today`} aria-valuenow={line.percentUsed} aria-valuemin={0} aria-valuemax={100}>
                        <div
                          className={cn('h-full rounded-full', line.tone === 'ok' ? 'bg-emerald-500' : line.tone === 'high' ? 'bg-amber-500' : 'bg-red-500/70')}
                          style={{ width: `${line.percentUsed}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div ref={list} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
              {empty && (
                <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
                  <button type="button" onClick={poke} aria-label="Say hi to Dex-E" className="cursor-pointer rounded-3xl">
                    <PondexMascot mood={mood} size={160} />
                  </button>
                  <h2 className="text-xl font-semibold">Hi, I’m Dex-E.</h2>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    I read your loans, payments and notes, and answer in plain words. I can also add, edit or pay
                    things, but only after you tap Confirm.
                  </p>
                  <div className="mt-1 flex w-full flex-col gap-2">
                    {SAMPLES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => ask(s)}
                        disabled={resting}
                        className="border-border bg-muted/40 hover:bg-accent hover:border-brand-line min-h-11 cursor-pointer rounded-2xl border px-4 py-2.5 text-left text-sm disabled:cursor-default disabled:opacity-50"
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
                      {m.steps && <DoneSteps steps={m.steps} thoughtMs={m.thoughtMs ?? 0} failed={m.failed} />}
                      <p className={cn('text-sm leading-relaxed whitespace-pre-line', m.failed && 'text-muted-foreground')}>
                        {m.text}
                        {!m.done && <span className="bg-brand animate-ask-caret ml-0.5 inline-block h-[1em] w-0.5 align-[-2px]" />}
                      </p>
                      {m.done && m.card && (
                        <ActionCard
                          proposal={m.card.proposal}
                          status={m.card.status}
                          error={m.card.error}
                          onStatus={(status, error) => setCard(m.id, status, error)}
                        />
                      )}
                    </div>
                  </div>
                ),
              )}

              {thinking && (
                <div className="animate-ask-rise flex flex-col gap-1">
                  <div className="flex items-center gap-2.5">
                    <PondexMascot mood="think" size={62} />
                    <span className="text-muted-foreground text-sm">Thinking</span>
                    <span className="flex gap-1">
                      <span className="bg-brand animate-ask-dot size-1.5 rounded-full" />
                      <span className="bg-brand animate-ask-dot size-1.5 rounded-full [animation-delay:.18s]" />
                      <span className="bg-brand animate-ask-dot size-1.5 rounded-full [animation-delay:.36s]" />
                    </span>
                  </div>
                  <div className="pl-[72px]">
                    <LiveSteps steps={liveSteps} />
                  </div>
                </div>
              )}
            </div>

            <div className="border-border/70 flex flex-col gap-2.5 border-t px-3 pt-2.5 pb-3">
              {resting && (
                <div role="status" className="bg-brand/8 text-foreground flex items-center gap-3 rounded-2xl px-3.5 py-2.5">
                  <Hourglass className="text-brand size-5 shrink-0" />
                  <p className="min-w-0 flex-1 text-sm leading-snug">
                    {usage?.status === 'out' ? (
                      <>
                        Dex-E used up today&apos;s free AI. Back at{' '}
                        <span className="text-brand font-semibold tabular-nums">{manilaTime(new Date(usage.coolUntil!))}</span>.
                      </>
                    ) : (
                      <>
                        Dex-E is busy (free plan, per minute). Ready again in{' '}
                        <span className="text-brand font-semibold tabular-nums">{clock(coolMs)}</span>.
                      </>
                    )}
                  </p>
                </div>
              )}
              {!empty && !resting && (
                <div className="flex gap-2 overflow-x-auto pb-0.5">
                  {SAMPLES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="border-border hover:bg-accent min-h-10 shrink-0 cursor-pointer rounded-full border px-3 text-xs whitespace-nowrap"
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
                  Ask Dex-E a question
                </label>
                <input
                  id="ask-pondex-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={resting ? (usage?.status === 'out' ? `Dex-E is resting. Back at ${manilaTime(new Date(usage.coolUntil!))}.` : 'Dex-E is busy. Try again shortly.') : 'Ask, or say what to change…'}
                  disabled={resting}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none md:text-sm"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  disabled={resting}
                  className="bg-brand text-brand-foreground hover:bg-brand-strong flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl disabled:cursor-default disabled:opacity-50"
                >
                  <ArrowUp className="size-5" />
                </button>
              </form>
              <p className="text-muted-foreground text-center text-[11px]">
                Dex-E never changes anything until you tap Confirm. Check important numbers in the app.
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
          <div className="animate-ask-bubble bg-brand text-brand-foreground shadow-brand/30 hidden rounded-[16px_16px_4px_16px] px-3.5 py-2.5 text-sm font-medium whitespace-nowrap shadow-xl sm:block">
            Hi! Ask me about your loans.
          </div>
        )}
        <button
          type="button"
          onClick={toggleOpen}
          aria-label={open ? 'Close Dex-E' : 'Open Dex-E'}
          aria-expanded={open}
          className="cursor-pointer rounded-3xl drop-shadow-xl transition-transform hover:-translate-y-0.5 hover:scale-105"
        >
          <PondexMascot mood={mood} size={84} />
        </button>
      </div>
    </>
  )
}
