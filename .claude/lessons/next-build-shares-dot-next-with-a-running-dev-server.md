# A `next build` beside a running `next dev` fails as a missing module

**When this applies:** running `npm run build` or `npm start` in this checkout
while any other session has `next dev` up — which in this project is the normal
state, not the exception.

On 2026-09-22 a production build run in place came up with:

```
ChunkLoadError: Cannot find module .../ssr/node_modules_1ejo5o_._.js
```

on `/borrowers/[id]`. Nothing was wrong with the dependency, the import, or the
route. `next build` and `next dev` both write to `.next/`, and the dev server on
:3001 was rewriting chunks while the build was emitting them. The build read a
filename the dev server had already replaced.

## Why it costs time

**The error names a module, so it gets debugged as a module problem** — a bad
import, a missing package, a stale `node_modules`. None of those is the cause,
and each is a plausible enough lead to spend a while on. There is nothing in the
message about concurrency, and the build exits 0: only opening the page shows
it.

It is also intermittent. A build that happens not to overlap a recompile
succeeds, so "it worked last time" carries no information.

## What to do instead

Build from an isolated copy whenever another dev server is up:

```bash
cp -Rc . /tmp/verify-app          # APFS clone: near-instant, real node_modules
cd /tmp/verify-app && npm run build && PORT=3999 npm start
```

`cp -Rc` rather than a symlink of `node_modules`: Turbopack refuses a symlinked
one outright — `Symlink [project]/node_modules is invalid, it points out of the
filesystem root` — so the shortcut fails for an unrelated reason and sends you
looking in a third wrong direction. `rsync` works too and is slower.

Do not kill the other session's dev server to clear the way. It belongs to work
in progress that is not yours; see the "Red is not automatically yours" rule in
CONVENTIONS.md, which is the same principle applied to a different shared
resource.

See also [[production-only-branches-need-a-production-run]] — that lesson is why
a production build gets run here at all, and this one is what it costs when the
tree is shared.
