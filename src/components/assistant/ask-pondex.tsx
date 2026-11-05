'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUp, CalendarClock, ChevronDown, HandCoins, Hourglass, Maximize2, Minimize2, PiggyBank, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clock, manilaTime, modelLines, type Status, statusLine } from '@/lib/assistant-status'
import { ActionCard, type CardStatus, type ProposalView } from './action-card.tsx'
import { PondexMascot, type MascotMood } from './pondex-mascot.tsx'
import { AnswerText } from './answer-text.tsx'
import { DoneSteps, LiveSteps, WRITING_STEP } from './step-list.tsx'
import { useTucked } from './use-tucked.ts'
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
 * Common questions (the suggestion buttons among them) the server answers
 * from the app's own numbers, with no AI (lib/quick-answers.ts), so those
 * buttons keep working while the AI rests.
 *
 * When every model is resting, a banner and a countdown say when
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
  | { id: number; role: 'bot'; text: string; full: string; done: boolean; failed?: boolean; card?: Card; steps?: Step[]; thoughtMs?: number; quick?: boolean; choices?: Choice[] }

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

/**
 * Starters: a short label to tap (shorter still in the row above the input, so all
 * four fit), and the full question it sends. All four are
 * answered by the server from real data, instantly and with no AI.
 */
const SAMPLES = [
  { icon: HandCoins, label: 'Out on loan', chip: 'Out on loan', ask: 'How much is out on loan right now?' },
  { icon: TriangleAlert, label: "Who's overdue", chip: 'Overdue', ask: 'Who is overdue right now?' },
  { icon: PiggyBank, label: 'Pot balances', chip: 'Pots', ask: 'How much is floating in each pot?' },
  { icon: CalendarClock, label: 'Due this week', chip: 'This week', ask: "What's due this week?" },
]

/** How long the launcher's "Hi" bubble stays before it tucks itself away. */
const BUBBLE_MS = 6000

/** A button under Dex-E's question: the label, and the whole sentence it sends. */
type Choice = { label: string; send: string }
type Answer = { text: string; failed: boolean; proposal: ProposalView | null; usage: Usage | null; thoughtMs: number; quick?: boolean; choices?: Choice[]; retry?: boolean }

/**
 * Test modes for the demo account, kept on for the tab once opened with the flag:
 *   ?dexe-server-only     the server alone, no AI at all
 *   ?dexe-translate-test  the server, its memory and the small translator, never the full AI
 * The server refuses both for any other account.
 */
function testModeOf(): 'server' | 'translate' | null {
  try {
    // The flag this tab used before the two modes existed, then whatever the address asks for now.
    if (sessionStorage.getItem('dexe-server-only') === '1') {
      sessionStorage.setItem('dexe-test', 'server')
      sessionStorage.removeItem('dexe-server-only')
    }
    const flags = new URLSearchParams(window.location.search)
    if (flags.has('dexe-server-only')) sessionStorage.setItem('dexe-test', 'server')
    if (flags.has('dexe-translate-test')) sessionStorage.setItem('dexe-test', 'translate')
    const mode = sessionStorage.getItem('dexe-test')
    return mode === 'server' || mode === 'translate' ? mode : null
  } catch {
    return null
  }
}

type Reply = { ok: true; answer: string; proposal: ProposalView | null; usage: Usage; quick?: boolean; choices?: Choice[] } | { ok: false; error: string; usage: Usage | null; retry?: boolean }

/** Asks, reading the steps as they arrive (one JSON line each) and the answer last. */
async function fetchAnswer(history: { role: 'user' | 'assistant'; text: string }[], onStep: (step: Step) => void, attempt = 1): Promise<Answer> {
  const started = Date.now()
  const took = () => Date.now() - started
  try {
    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: history, stream: true, ...(testModeOf() === 'server' ? { serverOnly: true } : testModeOf() === 'translate' ? { translateTest: true } : {}) }),
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
      ? { text: data.answer, failed: false, proposal: data.proposal, usage: data.usage, thoughtMs: took(), quick: data.quick, choices: data.choices }
      : { text: data.error, failed: true, proposal: null, usage: data.usage, thoughtMs: took(), retry: data.retry }
  } catch {
    // Seen on a phone on mobile data (2026-11-04): the request never reached the server. Asking
    // again is safe, since nothing is saved without Confirm, so it is tried once more before giving up.
    if (attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1200))
      return fetchAnswer(history, onStep, 2)
    }
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
  const tucked = useTucked()
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
  // The launcher's "Hi" bubble says hello for a few seconds after the page loads, then hides.
  // Hovering the mascot brings it back for a moment.
  const [bubble, setBubble] = useState(true)
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showBubbleFor = useCallback((ms: number) => {
    setBubble(true)
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    bubbleTimer.current = setTimeout(() => setBubble(false), ms)
  }, [])
  useEffect(() => {
    bubbleTimer.current = setTimeout(() => setBubble(false), BUBBLE_MS)
    return () => {
      if (bubbleTimer.current) clearTimeout(bubbleTimer.current)
    }
  }, [])
  // Shown in the header so a tester can see the AI is switched off. Read when the chat opens: it lives in the tab's storage.
  const [testMode, setTestMode] = useState<'server' | 'translate' | null>(null)
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
      setTestMode(testModeOf())
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
    // While the AI rests the input stays open: common checks and changes are the server's,
    // and anything that needs the AI gets a clear "used up" reply instead.
    if (!q || thinking || writing) return
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
    const { text: a, failed, proposal, usage: latest, thoughtMs, quick, choices: offered, retry } = await fetchAnswer(history, (step) => {
      steps = steps.some((s) => s.id === step.id) ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, step]
      setLiveSteps(steps)
    })
    // "Busy" is a short per-minute wait: one tap sends the same message again.
    const choices = retry ? [{ label: 'Try again', send: q }] : offered
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
      { id: id + 1, role: 'bot', text: '', full: a, done: false, failed, card, steps: steps.filter((s) => s.state !== 'doing'), thoughtMs, quick, choices },
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
  // Answer buttons only on Dex-E's latest message: an older question has moved on.
  const lastBotId = messages.findLast((m) => m.role === 'bot')?.id

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
                <p className="flex items-center gap-2 text-base font-semibold">
                  Dex-E
                  {testMode && <span className="bg-brand-bg text-brand border-brand-line rounded-full border px-2 py-0.5 text-[11px] font-medium">{testMode === 'translate' ? 'Test mode · translator' : 'Test mode · server only'}</span>}
                </p>
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
                <div className="m-auto flex w-full max-w-md flex-col items-center gap-2.5 text-center">
                  <button type="button" onClick={poke} aria-label="Say hi to Dex-E" className="cursor-pointer rounded-3xl">
                    <PondexMascot mood={mood} size={104} />
                  </button>
                  <h2 className="text-lg font-semibold">Hi, I’m Dex-E.</h2>
                  <p className="text-muted-foreground max-w-xs text-sm leading-relaxed">
                    Ask about your loans, or tell me what to change. Nothing is saved until you tap Confirm.
                  </p>
                  {/* Two by two, short labels: the whole question goes when one is tapped. */}
                  <div className="mt-2 grid w-full grid-cols-2 gap-2">
                    {SAMPLES.map(({ icon: Icon, label, ask: question }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => ask(question)}
                        title={question}
                        className="border-border bg-card hover:border-brand-line hover:bg-brand-bg focus-visible:ring-brand/40 group flex cursor-pointer items-center gap-2.5 rounded-2xl border p-3 text-left text-sm font-medium shadow-sm transition-[transform,background-color,border-color] outline-none hover:-translate-y-0.5 focus-visible:ring-2"
                      >
                        <span className="bg-brand-bg text-brand group-hover:bg-brand group-hover:text-brand-foreground flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors">
                          <Icon className="size-4" />
                        </span>
                        <span className="leading-tight">{label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Or type a change, like <span className="text-foreground">“Maria deposited 5k”</span>
                  </p>
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
                  <div key={m.id} className="animate-ask-rise flex max-w-full items-start gap-2 sm:max-w-[94%] sm:gap-2.5">
                    <PondexMascot mood={m.done ? 'idle' : 'talk'} size={46} className="size-8 shrink-0 sm:size-[46px]" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2.5 pt-2.5">
                      {m.steps && <DoneSteps steps={m.steps} thoughtMs={m.thoughtMs ?? 0} failed={m.failed} quick={m.quick} />}
                      <AnswerText
                        text={m.text}
                        failed={m.failed}
                        caret={!m.done && <span className="bg-brand animate-ask-caret ml-0.5 inline-block h-[1em] w-0.5 align-[-2px]" />}
                      />
                      {m.done && m.choices && m.id === lastBotId && !thinking && (
                        <div className="animate-ask-rise flex flex-wrap gap-2">
                          {m.choices.map((c) => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => ask(c.send)}
                              className="border-brand-line bg-brand-bg text-brand hover:border-brand focus-visible:ring-brand/40 min-h-10 cursor-pointer rounded-full border px-3.5 text-left text-sm font-medium outline-none focus-visible:ring-2"
                            >
                              {c.label}
                            </button>
                          ))}
                        </div>
                      )}
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
                    <PondexMascot mood="think" size={62} className="size-10 sm:size-[62px]" />
                    <span className="text-muted-foreground text-sm">Thinking</span>
                    <span className="flex gap-1">
                      <span className="bg-brand animate-ask-dot size-1.5 rounded-full" />
                      <span className="bg-brand animate-ask-dot size-1.5 rounded-full [animation-delay:.18s]" />
                      <span className="bg-brand animate-ask-dot size-1.5 rounded-full [animation-delay:.36s]" />
                    </span>
                  </div>
                  <div className="pl-12 sm:pl-[72px]">
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
                        <span className="text-brand font-semibold tabular-nums">{manilaTime(new Date(usage.coolUntil!))}</span>. Common
                        checks and changes still work.
                      </>
                    ) : (
                      <>
                        Dex-E is busy (free plan, per minute). Ready again in{' '}
                        <span className="text-brand font-semibold tabular-nums">{clock(coolMs)}</span>. Common
                        checks and changes still work.
                      </>
                    )}
                  </p>
                </div>
              )}
              {/* On a phone the last chip runs off the edge; the fade says the row scrolls. */}
              {!empty && (
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] max-sm:pr-8 max-sm:[mask-image:linear-gradient(to_right,black_80%,transparent)]">
                  {SAMPLES.map(({ icon: Icon, chip, ask: question }) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => ask(question)}
                      title={question}
                      className="border-border text-muted-foreground hover:text-brand hover:border-brand-line hover:bg-brand-bg focus-visible:ring-brand/40 flex min-h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap outline-none focus-visible:ring-2"
                    >
                      <Icon className="size-3.5" />
                      {chip}
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
                  placeholder={resting ? 'Common checks and changes still work…' : 'Ask, or say what to change…'}
                  autoComplete="off"
                  className="min-w-0 flex-1 bg-transparent py-2.5 text-base outline-none md:text-sm"
                />
                <button
                  type="submit"
                  aria-label="Send"
                  className="bg-brand text-brand-foreground hover:bg-brand-strong flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl disabled:cursor-default disabled:opacity-50"
                >
                  <ArrowUp className="size-5" />
                </button>
              </form>
              <p className="text-muted-foreground text-center text-[11px]">
                Dex-E never changes anything until you tap Confirm.<span className="hidden sm:inline"> Check important numbers in the app.</span>
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Above the phone tab bar on a phone, in the corner on a laptop. Hidden on a
          phone while the chat is open, since the panel covers the screen. Slides
          off to the side while scrolling down and at the foot of a page, so it is
          never on top of what is under it (use-tucked.ts). */}
      <div
        className={cn(
          'fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] z-40 flex items-center gap-3 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none md:right-6 md:bottom-6',
          open && 'hidden md:flex',
          tucked && !open && 'pointer-events-none translate-x-[calc(100%+2rem)] opacity-0',
        )}
        inert={tucked && !open}
      >
        {!open && (
          <div
            aria-hidden={!bubble}
            className={cn(
              'bg-brand text-brand-foreground shadow-brand/30 hidden rounded-[16px_16px_4px_16px] px-3.5 py-2.5 text-sm font-medium whitespace-nowrap shadow-xl transition-[opacity,transform] duration-500 sm:block',
              bubble ? 'animate-ask-bubble opacity-100' : 'pointer-events-none translate-x-2 opacity-0',
            )}
          >
            Hi! Ask me about your loans.
          </div>
        )}
        <button
          type="button"
          onClick={toggleOpen}
          onMouseEnter={() => !open && showBubbleFor(3000)}
          aria-label={open ? 'Close Dex-E' : 'Open Dex-E'}
          aria-expanded={open}
          className="relative isolate cursor-pointer rounded-full transition-transform hover:-translate-y-0.5 hover:scale-105"
        >
          {/* A soft glow behind the mascot, just enough to catch the eye on a light or a dark page
              (a little stronger on dark, where the navy mascot would otherwise fade in). */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-3 -z-10 rounded-full bg-[radial-gradient(circle,rgb(58_102_227/0.22)_0%,rgb(58_102_227/0.08)_45%,transparent_70%)] dark:bg-[radial-gradient(circle,rgb(120_150_255/0.38)_0%,rgb(120_150_255/0.14)_45%,transparent_70%)]"
          />
          <PondexMascot mood={mood} size={96} className="size-[88px] md:size-[96px]" />
        </button>
      </div>
    </>
  )
}
