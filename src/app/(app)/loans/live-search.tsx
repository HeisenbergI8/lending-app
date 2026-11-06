'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/** How long typing has to pause before the list updates. Short enough to feel live, long enough not to reload per letter. */
const TYPING_PAUSE_MS = 350

/**
 * Makes the loan search form apply itself: the list updates a moment after the
 * Admin stops typing, and at once when a date is picked. No Search button to
 * press (owner, 2026-11-06).
 *
 * It renders nothing of its own. It finds the form it sits in and, on each
 * change, loads the same URL the form would have submitted to — empty fields
 * left out, back on page 1 — with `replace`, so typing does not fill the Back
 * button with one entry per letter. Without JavaScript the form still submits
 * the ordinary way on Enter.
 */
export function LiveSearch() {
  const marker = useRef<HTMLSpanElement>(null)
  const router = useRouter()

  useEffect(() => {
    const form = marker.current?.closest('form')
    if (!form) return

    let timer: ReturnType<typeof setTimeout> | undefined

    const apply = () => {
      const params = new URLSearchParams()
      for (const [name, value] of new FormData(form)) {
        if (typeof value === 'string' && value.trim() !== '') params.set(name, value.trim())
      }
      const query = params.toString()
      const next = `${form.getAttribute('action') ?? ''}${query ? `?${query}` : ''}`
      if (next !== `${window.location.pathname}${window.location.search}`) router.replace(next, { scroll: false })
    }

    const onInput = (event: Event) => {
      clearTimeout(timer)
      // A date is a finished choice the moment it is picked; text is not.
      const typed = event.target instanceof HTMLInputElement && event.target.type !== 'date'
      timer = typed ? setTimeout(apply, TYPING_PAUSE_MS) : setTimeout(apply, 0)
    }
    const onSubmit = (event: Event) => {
      event.preventDefault()
      clearTimeout(timer)
      apply()
    }

    form.addEventListener('input', onInput)
    form.addEventListener('submit', onSubmit)
    return () => {
      clearTimeout(timer)
      form.removeEventListener('input', onInput)
      form.removeEventListener('submit', onSubmit)
    }
  }, [router])

  return <span ref={marker} hidden />
}
