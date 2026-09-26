/**
 * Light, dark, or whatever the device is set to.
 *
 * LIGHT IS THE DEFAULT, not the device. The Admin asked for the app to open
 * light and go dark only when told to, so nothing is stored until a choice is
 * made, and an empty slot means light.
 *
 * The choice lives in this browser's storage, like the sound switch. It is a
 * preference about this screen, not about the account, so it does not follow
 * the Admin to another device.
 *
 * THE SWITCH ITSELF IS PAINTED BEFORE REACT EXISTS. `THEME_SCRIPT` runs inline
 * in the <head>, so a dark page never flashes white on its way in. Everything
 * below only handles a change after that.
 */

export type ThemeMode = 'light' | 'dark' | 'system'

const KEY = 'pondex:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * The status bar colour on an installed phone app. The values are --background
 * from globals.css, the same ones the viewport export in the root layout uses:
 * a shade off shows as a seam across the top of the screen.
 */
const BAR = { light: '#f6f7f9', dark: '#0a0e15' }

/** How long the cross-fade runs. Matches the transition in globals.css. */
const FADE_MS = 550

/** Kept in step with the functions below by hand: it runs before any module loads. */
export const THEME_SCRIPT = `(function(){try{var m=localStorage.getItem("${KEY}");if(m==="dark"||(m==="system"&&matchMedia("${DARK_QUERY}").matches)){var r=document.documentElement;r.classList.add("dark");r.style.colorScheme="dark"}}catch(e){}})()`

const listeners = new Set<() => void>()
let fadeTimer: number | undefined

export function getThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'dark' || stored === 'system' ? stored : 'light'
  } catch {
    return 'light'
  }
}

export function isDark(mode: ThemeMode = getThemeMode()): boolean {
  if (mode === 'system') return window.matchMedia(DARK_QUERY).matches
  return mode === 'dark'
}

export function setThemeMode(mode: ThemeMode) {
  try {
    if (mode === 'light') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, mode)
  } catch {
    // Private windows can refuse storage; the choice then lasts until reload.
  }
  applyTheme({ animate: true })
  listeners.forEach((listener) => listener())
}

/**
 * Puts the page in step with the stored choice.
 *
 * THE FADE IS SWITCHED ON ONLY FOR THE CHANGE. `theme-changing` gives every
 * element the same soft colour transition for just over half a second and is
 * then taken away, so the hovers and presses the app already animates keep
 * their own timing the rest of the time. Reduced motion skips it.
 */
export function applyTheme({ animate }: { animate: boolean }) {
  const root = document.documentElement
  const dark = isDark()

  if (root.classList.contains('dark') !== dark) {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (animate && !still) {
      root.classList.add('theme-changing')
      window.clearTimeout(fadeTimer)
      fadeTimer = window.setTimeout(() => root.classList.remove('theme-changing'), FADE_MS + 50)
    }
    root.classList.toggle('dark', dark)
    root.style.colorScheme = dark ? 'dark' : 'light'
  }

  // Both tags, whatever their media query says: the Admin's choice outranks
  // the device's.
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', dark ? BAR.dark : BAR.light))
}

/**
 * For useSyncExternalStore. Also follows the device while "Device" is chosen,
 * so turning the phone dark at sunset turns the app dark with it.
 */
export function subscribeTheme(listener: () => void) {
  const query = window.matchMedia(DARK_QUERY)
  const onDeviceChange = () => {
    if (getThemeMode() === 'system') applyTheme({ animate: true })
    listener()
  }
  listeners.add(listener)
  query.addEventListener('change', onDeviceChange)
  return () => {
    listeners.delete(listener)
    query.removeEventListener('change', onDeviceChange)
  }
}
