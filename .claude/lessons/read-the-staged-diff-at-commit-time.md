# `git add` early and `git commit` late commits content nobody read

**When this applies:** any commit in this repo, and especially one where the
instruction was "commit only my work" while other changes sit in the tree.

On 2026-09-22 three files were staged, `git diff --staged --stat` was read and
showed the expected 48 insertions for a new `src/app/(app)/loading.tsx`. Some
verification and a second `git add` later, the commit landed as **19
insertions** of a file that had been rewritten on disk in between — by
concurrent work in the same tree — into a version importing
`@/components/brand-loader.tsx`.

That module was untracked and not in the commit. The pushed state would have
failed the Vercel build on a missing import, and the commit message described a
self-contained generic skeleton while the committed file said the opposite. Both
the code and the prose were wrong about the same diff.

Caught before pushing, at the cost of a `git reset --mixed HEAD~1`.

## Why

Staging is a snapshot; `git add` on the same path again silently replaces it
with whatever is on disk **now**. Nothing warns that the second add changed what
the first one captured. The gap between reading a staged diff and committing it
is a window, and in this project that window is not safe: files changed under
this session three times in one sitting (`src/server/db.ts`, `vercel.json`,
`src/app/(app)/loading.tsx`), because more than one agent or editor writes here.

The harness notice "changed on disk since you last read it" fires for files
**read with the Read tool**. Files written with a heredoc and never re-read get
no such notice, which is exactly how this one slipped through.

## The fix

Read `git diff --staged` as the LAST action before `git commit`, in the same
step, not before the verify run and not before anything else. If a staged path
was re-added after that read, read it again.

A cheap guard that catches it, run between staging and committing:

```bash
git diff --staged --stat          # the numbers you are about to commit
git diff --staged --name-only | xargs -I{} sh -c 'git diff --quiet -- "{}" || echo "UNSTAGED EDITS PENDING: {}"'
```

Anything printed by the second line means the working tree has moved past the
index for that path — stop and look at it.

## Also

A new file that imports a still-untracked module is the specific failure this
produces, and `npm run verify` and `npm run build` will NOT catch it: both read
the working tree, where the import resolves fine. Only the committed tree is
missing the module. Before pushing a commit that adds a file, check that
everything it imports is tracked:

```bash
git show --stat HEAD                     # what actually went in
git ls-files --error-unmatch <each import target>
```
