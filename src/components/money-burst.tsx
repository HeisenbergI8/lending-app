'use client'

import { useEffect, useRef } from 'react'

import type { Sound } from '@/lib/sound.ts'

/**
 * Coins and cash for the money actions, drawn at the same instant as their sound.
 *
 * It listens for the event sound.ts fires from play(), rather than being called
 * beside it, so the picture and the sound share one trigger and cannot drift.
 * That event fires even when sound is muted: the coins are the quiet version.
 *
 * ONLY MONEY MOVES GET COINS. Payments and deposits are cashIn, withdrawals,
 * new loans and advances are cashOut. Saving a note stays calm.
 *
 * The timings follow the recipes in sound.ts: cashIn is two glass notes 75ms
 * apart and a high glint at 150ms, so two navy rings 75ms apart and sparkles
 * from 150ms; cashOut is one breath of air outwards, so one ring and everything
 * thrown clear of the coin.
 *
 * Approved on the design canvas as "Money in and out, new".
 */

/** The Pondex mark, stamped on every coin and bill. */
const MARK = `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true"><g fill="currentColor"><rect x="0" y="0" width="39" height="100"/><rect x="45" y="0" width="55" height="30"/><rect x="45" y="36" width="55" height="64"/></g></svg>`

const COIN = `<div style="position:relative;width:100%;height:100%;border-radius:999px;background:linear-gradient(150deg,#fff3c4 0%,#f9d25c 28%,#e8a92a 62%,#b97a12 100%);box-shadow:inset 0 -2px 0 rgb(120 70 0/.35),inset 0 2px 0 rgb(255 255 255/.6),0 6px 14px rgb(150 95 10/.28);display:flex;align-items:center;justify-content:center;overflow:hidden">
  <div style="width:76%;height:76%;box-sizing:border-box;border-radius:999px;border:1.5px solid rgb(150 95 10/.45);background:linear-gradient(150deg,#fbe08a,#eab13a);display:flex;align-items:center;justify-content:center;color:#93600c">
    <div style="width:44%;height:44%;filter:drop-shadow(0 1px 0 rgb(255 255 255/.55))">${MARK}</div>
  </div>
  <div data-shine style="position:absolute;top:-20%;left:0;width:45%;height:140%;background:linear-gradient(90deg,rgb(255 255 255/0),rgb(255 255 255/.75),rgb(255 255 255/0));transform:translateX(-150%) rotate(20deg)"></div>
</div>`

const BILL = `<div style="position:relative;width:100%;height:100%;box-sizing:border-box;border-radius:5px;background:linear-gradient(135deg,#7fcf9f 0%,#3f9e6b 45%,#2a7a52 100%);box-shadow:inset 0 0 0 1px rgb(255 255 255/.35),0 6px 14px rgb(20 80 50/.25);overflow:hidden;display:flex;align-items:center;justify-content:space-between;padding:0 9%">
  <div style="position:absolute;inset:3px;border-radius:3px;border:1px solid rgb(220 255 235/.45)"></div>
  <div style="width:16%;height:30%;border-radius:999px;background:rgb(220 255 235/.35)"></div>
  <div style="width:34%;aspect-ratio:1;border-radius:999px;background:linear-gradient(150deg,#fbe08a,#e8a92a);box-shadow:inset 0 0 0 1px rgb(150 95 10/.4);display:flex;align-items:center;justify-content:center;color:#93600c">
    <div style="width:48%;height:48%">${MARK}</div>
  </div>
  <div style="width:16%;height:30%;border-radius:999px;background:rgb(220 255 235/.35)"></div>
</div>`

const GLOW = `<div style="width:100%;height:100%;border-radius:999px;background:radial-gradient(closest-side,rgb(249 210 92/.45),color-mix(in oklab,var(--brand) 12%,transparent) 60%,transparent)"></div>`

const RING = `<div style="width:100%;height:100%;box-sizing:border-box;border-radius:999px;border:2px solid color-mix(in oklab,var(--brand) 50%,transparent)"></div>`

const SPARKLE = `<svg viewBox="0 0 20 20" width="100%" height="100%" aria-hidden="true"><path d="M10 0 C10.8 6.5 13.5 9.2 20 10 C13.5 10.8 10.8 13.5 10 20 C9.2 13.5 6.5 10.8 0 10 C6.5 9.2 9.2 6.5 10 0 Z" fill="#fff4c9"/></svg>`

const SPRING = 'cubic-bezier(.34,1.56,.64,1)'

const random = (min: number, max: number) => min + Math.random() * (max - min)

// Every frame names the same transforms in the same order, so they blend smoothly.
/** Coins spin on their upright axis. */
const coinAt = (x: number, y: number, spin: number, scale: number, tilt = 0) =>
  `translate(${x}px, ${y}px) perspective(500px) rotateY(${spin}deg) rotate(${tilt}deg) scale(${scale})`
/** Bills tumble end over end and sway. */
const billAt = (x: number, y: number, flip: number, tilt: number, scale: number) =>
  `translate(${x}px, ${y}px) perspective(500px) rotateX(${flip}deg) rotate(${tilt}deg) scale(${scale})`

function piece(stage: HTMLElement, html: string, width: number, height = width): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  el.style.cssText = `position:absolute;left:50%;top:50%;width:${width}px;height:${height}px;margin:${-height / 2}px 0 0 ${-width / 2}px;will-change:transform,opacity`
  stage.appendChild(el)
  return el
}

function run(el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
  const animation = el.animate(frames, { fill: 'both', ...options })
  animation.onfinish = () => el.remove()
}

/** A path sampled into frames, fading in at the start and out over the last stretch. */
function path(points: number, at: (t: number) => string, fadeFrom = 1): Keyframe[] {
  return Array.from({ length: points + 1 }, (_, k) => {
    const t = k / points
    const opacity = k === 0 ? 0 : t > fadeFrom ? (1 - t) / (1 - fadeFrom) : 1
    return { transform: at(t), opacity, offset: t }
  })
}

/** The glow, the navy rings and the big coin, shared by both. */
function core(stage: HTMLElement, kind: 'in' | 'out') {
  run(
    piece(stage, GLOW, 280),
    [
      { transform: 'scale(.4)', opacity: 0 },
      { transform: 'scale(1)', opacity: 1, offset: 0.3 },
      { transform: 'scale(1.1)', opacity: 0 },
    ],
    { duration: 1050, easing: 'ease-out' },
  )

  for (const delay of kind === 'in' ? [0, 75] : [0]) {
    run(
      piece(stage, RING, 84),
      [
        { transform: 'scale(1)', opacity: 0.9 },
        { transform: 'scale(2.5)', opacity: 0 },
      ],
      { duration: 700, delay, easing: 'cubic-bezier(.2,.7,.3,1)' },
    )
  }

  const coin = piece(stage, COIN, 84)
  run(
    coin,
    [
      { transform: coinAt(0, 0, -200, 0.5), opacity: 0, easing: SPRING },
      { transform: coinAt(0, 0, 0, 1.06), opacity: 1, offset: 0.3, easing: 'ease-out' },
      { transform: coinAt(0, 0, 0, 1, kind === 'out' ? -8 : 0), opacity: 1, offset: 0.42, easing: 'ease-out' },
      { transform: coinAt(0, 0, 0, 1), opacity: 1, offset: 0.78, easing: 'ease-in' },
      { transform: kind === 'in' ? coinAt(0, -6, 0, 0.9) : coinAt(12, -12, 0, 0.85), opacity: 0 },
    ],
    { duration: 1050, easing: 'linear' },
  )
  coin.querySelector<HTMLElement>('[data-shine]')?.animate(
    [{ transform: 'translateX(-150%) rotate(20deg)' }, { transform: 'translateX(300%) rotate(20deg)' }],
    { duration: 520, delay: 210, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'both' },
  )
}

/** Bills fan out behind the coin like a paid stack, small coins arc in and drop into it. */
function cashIn(stage: HTMLElement) {
  // Appended first, so they sit behind the big coin.
  const fan: [number, number, number, number, number][] = [
    [-150, -60, -30, -20, -14],
    [0, -190, 0, 0, -26],
    [150, -60, 30, 20, -14],
  ]
  fan.forEach(([sx, sy, fx, tilt, fy], i) => {
    run(
      piece(stage, BILL, 78, 40),
      [
        { transform: billAt(sx, sy, 70, tilt * 2.5, 0.7), opacity: 0, easing: 'cubic-bezier(.2,.9,.3,1.15)' },
        { transform: billAt(fx, fy - 14, 0, tilt, 1), opacity: 1, offset: 0.34 },
        { transform: billAt(fx, fy - 14, 0, tilt, 1), opacity: 1, offset: 0.76, easing: 'ease-in' },
        { transform: billAt(fx, fy - 20, 0, tilt, 0.9), opacity: 0 },
      ],
      { duration: 1020 - i * 45, delay: 30 + i * 45, easing: 'linear' },
    )
  })

  for (let i = 0; i < 7; i++) {
    const angle = ((-165 + i * 25 + random(-6, 6)) * Math.PI) / 180
    const reach = random(150, 185)
    const sx = Math.cos(angle) * reach
    const sy = Math.sin(angle) * reach
    // A curve that bows outward before it falls in.
    const cx = sx * 0.9
    const cy = sy * 0.2 - 40
    const spin = random(360, 720) * (Math.random() < 0.5 ? -1 : 1)
    const frames = path(8, (t) => {
      const u = 1 - t
      return coinAt(u * u * sx + 2 * u * t * cx, u * u * sy + 2 * u * t * cy, spin * t, 1 - 0.55 * t)
    }, 0.99)
    run(piece(stage, COIN, random(22, 30)), frames, {
      duration: random(380, 480),
      delay: random(0, 90),
      easing: 'cubic-bezier(.45,0,.75,.6)',
    })
  }

  core(stage, 'in')

  ;[[-46, -40, 16], [50, -26, 12], [36, 44, 10]].forEach(([x, y, size], i) => {
    run(
      piece(stage, SPARKLE, size),
      [
        { transform: `translate(${x}px, ${y}px) rotate(0deg) scale(0)`, opacity: 0 },
        { transform: `translate(${x}px, ${y}px) rotate(45deg) scale(1.1)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${x}px, ${y}px) rotate(90deg) scale(0)`, opacity: 0 },
      ],
      { duration: 420, delay: 150 + i * 40, easing: 'ease-out' },
    )
  })
}

/** Coins fountain out from behind the big one, bills float out slower and flutter down. */
function cashOut(stage: HTMLElement) {
  for (let i = 0; i < 4; i++) {
    const vx = (i % 2 ? 1 : -1) * random(90, 200)
    const vy = random(-560, -430)
    const side = vx < 0 ? -1 : 1
    run(
      piece(stage, BILL, 70, 36),
      path(10, (t) =>
        billAt(
          vx * t + Math.sin(t * 9) * 12,
          vy * t + 400 * t * t,
          Math.sin(t * 11 + i) * 60,
          side * (10 + t * 40) + Math.sin(t * 8) * 12,
          0.6 + 0.4 * Math.min(1, t * 4),
        ),
      0.7),
      { duration: 1000, delay: random(0, 90), easing: 'linear' },
    )
  }

  for (let i = 0; i < 10; i++) {
    const vx = random(-280, 280)
    const vy = random(-720, -540)
    const spin = random(360, 900) * (vx < 0 ? -1 : 1)
    const seconds = 0.8
    run(
      piece(stage, COIN, random(20, 30)),
      path(8, (t) => {
        const s = t * seconds
        return coinAt(vx * s, vy * s + 750 * s * s, spin * t, 0.6 + 0.4 * Math.min(1, t * 4))
      }, 0.7),
      { duration: seconds * 1000, delay: random(20, 110), easing: 'linear' },
    )
  }

  core(stage, 'out')
}

const BURSTS: Partial<Record<Sound, (stage: HTMLElement) => void>> = { cashIn, cashOut }

export function MoneyBurst() {
  const stage = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onSound = (event: Event) => {
      const burst = BURSTS[(event as CustomEvent<Sound>).detail]
      if (!burst || !stage.current) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      try {
        burst(stage.current)
      } catch {
        // Like the sound, the coins are a nicety and never worth an error.
      }
    }
    window.addEventListener('pondex:sound', onSound)
    return () => window.removeEventListener('pondex:sound', onSound)
  }, [])

  return <div ref={stage} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[100] overflow-hidden" />
}
