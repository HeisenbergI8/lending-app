# Measuring rendered style in a headless browser lies silently

**When this applies:** checking contrast, colour, or touch-target size by driving
Chrome over CDP against this app.

Both traps below return *plausible numbers*, not an error. Nothing fails, so the
wrong answer gets reported as fact.

## 1. Colours come back as `oklab()` / `lab()`, not `rgb()`

`globals.css` defines every token in `oklch`. `getComputedStyle(el).color` then
returns e.g. `oklab(0.999 0.00004 0.00002 / 0.75)`. Pulling the digits out with a
regex and treating them as R,G,B yields garbage — it reported white-on-indigo as
**1.1:1** (real answer: 5.3:1) and produced four contrast "failures" that did not
exist.

**Do this instead** — let a canvas convert and composite, including alpha:

```js
const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })
const paint = (layers) => {            // layers: outermost bg → … → fg
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1, 1)
  for (const c of layers) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1) }
  const d = ctx.getImageData(0, 0, 1, 1).data
  return { r: d[0], g: d[1], b: d[2] }
}
```

Walk ancestors collecting non-transparent `backgroundColor` outermost-first; the
canvas handles `oklab`, `lab`, `color-mix` and alpha blending for free.

## 2. `pointer: coarse` does NOT come from `Emulation.setEmulatedMedia`

Chrome rejects `pointer` as a media override — it silently stays `fine`. The app
sizes controls with Tailwind's `pointer-fine:` variant, so without real touch
emulation you measure the dense desktop layout and wrongly conclude the 44px
touch targets were never applied.

```js
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' })
```

`maxTouchPoints` must be 1–16; passing `0` throws.

## Also

- `Input.dispatchMouseEvent` hung for 10 minutes. Use `el.click()` or a
  dispatched `KeyboardEvent` via `Runtime.evaluate`.
- The session cookie is httpOnly — clearing `document.cookie` cannot sign you
  out. Use `Network.clearBrowserCookies`.
- These sweeps take minutes and buffer; redirect to a file and read that.
