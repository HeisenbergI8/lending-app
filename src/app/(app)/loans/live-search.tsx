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
      // Mid-composition (a phone's predictive keyboard, an IME), the text is not
      // what the Admin means yet; the input that ends composition comes next.
      if ((event as InputEvent).isComposing) return
      clearTimeout(timer)
      const field = event.target instanceof HTMLInputElement ? event.target : null
      if (field?.type === 'date') {
        // A date picked from the calendar is finished at once. One typed by hand
        // reports every keystroke of the year ("0002"), so only a cleared box or
        // a four-digit year from 1900 on is acted on.
        if (field.value === '' || Number(field.value.slice(0, 4)) >= 1900) timer = setTimeout(apply, 0)
        return
      }
      timer = setTimeout(apply, TYPING_PAUSE_MS)
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
