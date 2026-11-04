# Dex-E eval runner

Scripts that test Dex-E end to end on the **demo account only**. Every script that confirms a
change checks first that it is signed in as the demo account (`isDemo`) and stops if not.

Before running:
- Run the app locally on port 3456: `npx next dev -p 3456`.
- To test without spending Groq's free allowance, run Ollama with `qwen3:8b` and set
  `ASSISTANT_LOCAL_MODEL=qwen3:8b` in `.env.local`.
- The browser scripts use Playwright. They import it from the code-video skill's install
  (`client.mjs`, first line); point that at any Playwright install.
- `npm run db:seed` resets the demo account. The scenario runner does this itself before each scenario that makes a change.

| Script | What it checks |
|---|---|
| `run-scenarios.ts <out.jsonl> proof.png [ids]` | Runs the scenarios in `../chat-scenarios.json` through the chat and records every answer, card and Confirm. |
| `setups.ts` | Exact setup steps for scenarios that run "after" another one. |
| `regress-actions.ts proof.png` | Every action type through the Confirm step (49 checks). |
| `regress-proposals.ts` | Card checks: did-you-mean, look-alike warnings, unknown ids, names and weeks resolved on the server. |
| `regress-ui.mjs <dir>` / `regress-ui2.ts` | The chat window: counter, countdown, replaced cards, refusals, offline, long messages. |
| `regress-usage.ts` | The usage counter and cooldown in the database (uses made-up model names and removes them). |

Run the TypeScript ones with `node --env-file=.env --experimental-strip-types <script>` from the repo root.
Results from the 2026-11-04 overnight run are in `../results-2026-11-04.md`.
