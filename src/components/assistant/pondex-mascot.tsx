import { useId } from 'react'
import { cn } from '@/lib/utils'

export type MascotMood = 'idle' | 'happy' | 'think' | 'talk'

/**
 * Pondex as a character: the mark's three parts are its face, on a rounded
 * body with mitten hands and feet. Eyes only, no mouth.
 *
 * Every pose is drawn at once and the mood class decides which parts show and
 * how they move (keyframes: globals.css, "ASK PONDEX"). Switching mood is then
 * a class change, so a pose eases into the next instead of the SVG remounting.
 *
 *   idle   bobs, blinks, waves now and then
 *   happy  jumps with both arms up and ^ ^ eyes (a click)
 *   think  hand on chin, eyes up, a question mark (before the answer starts)
 *   talk   types on a laptop (while the answer writes itself out)
 *
 * useId keeps the gradient ids unique: the launcher, the panel header and every
 * answer draw their own copy, and a shared id would make all of them paint
 * from whichever copy came first in the page.
 */
export function PondexMascot({
  mood = 'idle',
  size = 64,
  className,
}: {
  mood?: MascotMood
  size?: number
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const body = `pdx-body-${id}`
  const white = `pdx-white-${id}`
  const screen = `pdx-screen-${id}`
  const outline = '#142a78'

  return (
    <svg
      viewBox="0 0 240 240"
      width={size}
      height={size}
      aria-hidden
      className={cn('mascot block overflow-visible', `mascot-${mood}`, className)}
    >
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#3a66e3" />
          <stop offset="1" stopColor="#1a39ab" />
        </linearGradient>
        <linearGradient id={white} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dde3f5" />
        </linearGradient>
        <linearGradient id={screen} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a9b5ee" />
          <stop offset="1" stopColor="#7686d6" />
        </linearGradient>
      </defs>

      <ellipse className="mascot-shadow" cx="120" cy="206" rx="58" ry="8" fill="#0b1530" opacity=".16" />

      <g className="mascot-question">
        <path
          d="M184 36q0-18 17-18t17 16q0 10-11 14q-6 2-6 9v3"
          fill="none"
          stroke="#2449c4"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="201" cy="74" r="5.5" fill="#2449c4" />
      </g>
      <g className="mascot-sparks" fill="none" stroke="#2449c4" strokeWidth="8" strokeLinecap="round">
        <path d="M40 60l14 12M62 34l6 17M26 90l17 2M200 60l-14 12M178 34l-6 17M214 90l-17 2" />
      </g>
      <g className="mascot-wave-lines" fill="none" stroke="#2449c4" strokeWidth="7" strokeLinecap="round">
        <path d="M14 52l12 9M28 30l9 13M48 18l3 15" />
      </g>

      <ellipse cx="100" cy="190" rx="18" ry="12" fill={`url(#${white})`} stroke={outline} strokeWidth="4" />
      <ellipse cx="140" cy="190" rx="18" ry="12" fill={`url(#${white})`} stroke={outline} strokeWidth="4" />

      <g className="mascot-body">
        <Arm className="mascot-arm-left" x={66} fill={white} />
        <Arm className="mascot-arm-right" x={174} fill={white} />

        <rect x="58" y="52" width="124" height="126" rx="40" fill={`url(#${body})`} stroke={outline} strokeWidth="5" />
        <ellipse cx="94" cy="68" rx="24" ry="7" transform="rotate(-10 94 68)" fill="#ffffff" opacity=".2" />

        {/* The mark, as the face. */}
        <rect x="80" y="76" width="35" height="80" rx="11" fill={`url(#${white})`} />
        <rect x="121" y="76" width="39" height="45" rx="11" fill={`url(#${white})`} />
        <rect x="121" y="127" width="39" height="29" rx="10" fill={`url(#${white})`} />

        <g className="mascot-eyes">
          <g className="mascot-eye">
            <ellipse cx="97" cy="100" rx="6.5" ry="10" fill="#14347f" />
            <circle cx="99.5" cy="95.5" r="2.8" fill="#ffffff" />
          </g>
          <g className="mascot-eye">
            <ellipse cx="140" cy="100" rx="6.5" ry="10" fill="#14347f" />
            <circle cx="142.5" cy="95.5" r="2.8" fill="#ffffff" />
          </g>
        </g>
        <path
          className="mascot-joy"
          d="M88 103q9-12 18 0M131 103q9-12 18 0"
          fill="none"
          stroke="#14347f"
          strokeWidth="6"
          strokeLinecap="round"
        />

        <g className="mascot-chin">
          <path
            d="M76 152c-5-14 9-24 25-21c15 3 25 11 21 22c-4 10-21 14-33 11c-7-2-11-6-13-12z"
            fill={`url(#${white})`}
            stroke={outline}
            strokeWidth="4"
            strokeLinejoin="round"
          />
        </g>

        <g className="mascot-laptop">
          <path d="M140 184L150 128L222 120L212 176Z" fill={`url(#${screen})`} stroke={outline} strokeWidth="4" strokeLinejoin="round" />
          <circle cx="184" cy="152" r="4.5" fill="#ffffff" opacity=".9" />
          <path d="M92 190L212 176L218 185L98 200Z" fill="#c4ccef" stroke={outline} strokeWidth="4" strokeLinejoin="round" />
          <Hand className="mascot-tap-left" d="M96 186c-3-9 6-15 16-13c9 2 15 7 12 13c-3 6-13 8-20 6c-4-1-7-3-8-6z" fill={white} />
          <Hand className="mascot-tap-right" d="M176 176c-3-9 6-15 16-13c9 2 15 7 12 13c-3 6-13 8-20 6c-4-1-7-3-8-6z" fill={white} />
        </g>
      </g>
    </svg>
  )
}

/** A mitten arm hanging from its shoulder at (x, 120). The CSS swings it from there. */
function Arm({ className, x, fill }: { className: string; x: number; fill: string }) {
  return (
    <g className={className}>
      <g transform={`translate(${x} 120)`}>
        <path
          d="M-11 -6C-13 10-17 21-17 30C-17 47 17 47 17 30C17 21 13 10 11-6Z"
          fill={`url(#${fill})`}
          stroke="#142a78"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M-8 34q8 5 16 0" fill="none" stroke="#c3cce8" strokeWidth="3" strokeLinecap="round" />
      </g>
    </g>
  )
}

function Hand({ className, d, fill }: { className: string; d: string; fill: string }) {
  return (
    <g className={className}>
      <path d={d} fill={`url(#${fill})`} stroke="#142a78" strokeWidth="4" strokeLinejoin="round" />
    </g>
  )
}
