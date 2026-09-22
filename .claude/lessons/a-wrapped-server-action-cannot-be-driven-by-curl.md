# A wrapped server action cannot be driven by curl

**When this applies:** verifying that a WRITE works in production mode, when the
form posting it is a `FormDialog` or anything else that wraps the action in
`useActionState`. In this project that is most of them.

On 2026-09-22, closing out the notes and advances work, the production server
was up and the two new forms needed exercising. Neither could be posted.

A form rendered server-side with the action passed **unwrapped** carries
`$ACTION_REF_*` / `$ACTION_1:0` hidden inputs, and a plain multipart POST to the
page URL runs it — that is how the login form was driven in the same session, in
one curl. A **wrapped** action has none of them, by the same mechanism
CONVENTIONS.md already describes: the wrapper is what costs the form its
no-JavaScript fallback, so there is nothing in the HTML to post.

What is left is React's RSC reply protocol: `Next-Action: <id>` plus a field `0`
holding the argument array with the FormData as `"$K" + key.toString(16)`, and
its entries re-prefixed. Roughly a dozen attempts at that encoding got as far as
the action *running* and returning its own validation refusal — proof the route,
the session and `useActionState` were wired correctly — and never got a
populated FormData through. The prefix is
`formFieldPrefix + "_" + key + "_"` with `formFieldPrefix === ""`
(`node_modules/next/dist/compiled/react-server-dom-turbopack-experimental/cjs/react-server-dom-turbopack-client.node.development.js`,
near `value instanceof FormData`), and even knowing that, it did not resolve.

## What to do instead

**Drive a real browser.** This is the answer, and it is cheaper than it sounds.
There is no Playwright in this repo, and installing one is not necessary: a
headless Chrome plus about ninety lines of WebSocket CDP client
(`Runtime.evaluate` to fill the fields, `document.querySelector('form')` and a
real submit event) executes the client JS, so React does its own encoding and
there is nothing to hand-craft. That route drove every form in this project's
notes-and-advances work end to end, including the refusals, in one pass.

Being in a real browser also buys the tests worth having: strip a `required`
attribute or overwrite a hidden `loanId` with JS and submit anyway, and you find
out whether the SERVER guard exists or whether the form was the only thing
holding the line.

Do NOT budget time for hand-encoding an RSC reply over curl. If you have already
started, the useful stopping point is the action returning its own validation
refusal — that proves routing, session and signature, and nothing about the
happy path.

And if no browser is available at all: verify the write one layer down, with a
script under `NODE_ENV=production node --env-file=.env` importing
`src/server/db.ts` — the real client, the real pool, the real database, which is
the point of [[production-only-branches-need-a-production-run]] — and then **say
the form path is unverified, in those words**. Reporting a db-layer pass as if
it were a UI pass is the failure this lesson exists to prevent.

Whatever route you take: use the demo account, and destroy what you create.
Deleting through the app's own UI only ARCHIVES a row — correct behaviour, and
not cleanup.
