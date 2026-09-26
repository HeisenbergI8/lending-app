'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

import { playArmed } from '@/lib/sound.ts'

/**
 * Plays the sound of an action that answered by changing screen.
 *
 * Sits in the root layout because that is the one part of the page that
 * survives the move from signing in to the dashboard.
 */
export function SoundOnNavigate() {
  const pathname = usePathname()
  useEffect(() => {
    playArmed()
  }, [pathname])
  return null
}
