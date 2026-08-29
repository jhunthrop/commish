# Sunday v5 — the self and operator surfaces: test ledger

**Track:** the self room and the operator console (`/app/profile`, `/app/wallet`, and the seven
`/app/admin/**` pages).
**Territory:** `src/account-room/**`, `src/admin-room/**`, the route files under `src/app` serving
only those routes, plus two NEW files under `src/components/ui`.
**Branch:** `worktree-v5-self`.

**Tests are DEFERRED for this campaign** by the track brief: no `vitest` run. The per-commit gate
is `tsc --noEmit` clean on production files, plus `eslint` on every touched path, plus the spec's
own execution doctrine — **the acceptance criterion is a screenshot**, taken from this worktree's
own dev server on **port 3013**, both themes, 1440 and 390.

## What was actually run, per commit

| Commit | `tsc --noEmit` | `eslint` | Screenshots |
|---|---|---|---|
| `40e0406` two v5 primitives | clean on production files | clean on `tower-figure.tsx`, `chapter-band.tsx` | (no surface of its own) |
| `00109fe` the self room reads as a tower | clean on production files | clean on `src/account-room`, `profile/page.tsx` | `/app/profile` dark, 1440 |
| `65e0135` law 6 on the wallet | clean on production files | clean on `src/account-room`, `wallet/**` | `/app/wallet` dark, 1440 |
| `7760740` the queue banded and ended | clean on production files | clean on `src/admin-room`, `admin/**` | `/app/admin/queue`, `/money/reconcile` dark, 1440 |
| the self-and-operator sweep | clean on production files | clean on all four territories | **all nine surfaces, dark + light, 1440 + 390** |

Nine surfaces × two themes × two viewports = 36 full-page renders, all HTTP 200:
`/app/profile`, `/app/wallet`, `/app/admin/queue`, `/app/admin/queue/[flagId]`,
`/app/admin/holds`, `/app/admin/exclusions`, `/app/admin/leagues/settle`,
`/app/admin/leagues/dissolve`, `/app/admin/money/reconcile`.

**The one standing `tsc` failure is not this track's**, and is the same one the storefront ledger
records: `src/league-room/components/league-row.test.tsx` and `league-row.hydration.test.tsx` do
not pass `position`, which `LeagueRow` made required when the board became a ranked tower. Both
are TEST files owned by the board track and both predate this branch.

## How the surfaces were reached

`LAB_EMAIL` unset, so `scripts/mint-dev-session.ts` minted a **fresh throwaway WorkOS test-
directory identity** (`commish-lab+…@commish-lab.test`, `user_01M15K3CM9VJAY2DZ24DZ5NQV4`). That
account has its own empty wallet and an untouched profile, which is exactly the dormant state both
member surfaces most need proving.

**Operator access was granted to that throwaway user and to no other**, via
`scripts/grant-admin.ts --user user_01M15K3CM9VJAY2DZ24DZ5NQV4 --by dev_user_01` — the seed
account, since `--by bootstrap` is legal only on a database with no admin at all and this one
already had four. No real account was touched.

`scripts/lab-shot.ts` was **not** used: it hard-codes `http://localhost:3000`, and this track was
forbidden to touch that port. A throwaway driver in the session scratchpad pointed at 3013 instead.
Nothing in the repo was changed to accommodate it.

## Tests that were TOUCHED but not run

One file, edited because leaving it stale would have been a lie in source:

- `src/admin-room/components/operator-tool.test.tsx` — the no-drama assertion's regex grew one
  alternative, `-live`. The charter it enforces did not change; v5 added a fourth way drama can
  arrive on a surface (the live channel) and the test that names the other three had to name it
  too. **Not executed.** It is the first place a failure should be expected.

No other test file was edited. Several will now be **stale in fact**, and the list below is the
honest inventory of what a suite run should be expected to surface:

- `manager-header.test.tsx` — the `InfoTip` beside the verified badge is gone, the tier badge is
  neutral rather than `positive`, and the seasons figure is a `TowerFigure` rather than a `Stat`.
- `notification-summary.test.tsx` — the per-topic channel `Badge` moved into the panel's `meta`.
- `theme-switcher.test.tsx` — the `Panel` wrapper and the resolution SENTENCE are gone; the
  resolution is a value string in a foot band now.
- `wallet-panel.test.tsx` — one hero branch instead of two.
- `review-feed.test.tsx` / `notice-inbox.test.tsx` — one `InfoTip` removed from each.
- `queue-table.test.tsx` — two tables under two bands instead of one, plus a lower third.
- `page.test.tsx` for `/app/wallet` — the dark branch grew a `LowerThird` and lost the panel's own
  button.
- `holds-control.test.tsx`, `settle-league-control.test.tsx`, `dissolve-league-control.test.tsx` —
  field hints trimmed or dropped. `rendered-copy.test.tsx` was grepped first: none of the four
  trimmed strings is asserted anywhere outside its own component.

## New files, reported as the brief requires

Two, both under `src/components/ui`, both reached by their own path rather than through the barrel
(`index.ts` is an existing file this track was forbidden to edit, and the barrel's own docblock
already sanctions direct imports for a component nothing else yet renders):

- **`tower-figure.tsx`** — `TowerFigure`, the hero figure that can never take a comparison. Three
  callers: `ManagerHeader` (seasons finished), `WalletPanel` (the balance, both states),
  `ReconcileDriftPanel` (drift). Its `absent` prop is what collapsed the wallet's two hand-rolled
  hero branches into one.
- **`chapter-band.tsx`** — `ChapterBand`, law 5's filled plate plus its consequence in words.
  One caller today, `QueueTable`'s age split. **`public-league-list.tsx` hand-rolls the identical
  four classes for its own two bands** and should be pointed at this component by whoever owns
  that file; it was not touched here because it is another track's territory.

## Not closed

- **The live wallet is unverified by screenshot.** `moneyIsLive()` is false and ships with no
  injection seam, so the branch carrying the real balance, the four forms and the
  identity-gate-or-`Add money` verb was written and type-checked but never rendered. The dark
  branch — the one every real request reaches — is verified in both themes at both widths.
- **The cleared queue is unverified by screenshot.** The dev database has four open flags and no
  way to empty it without writing to shared state. The "no rows, therefore no lower third" branch
  is a code branch, read but not seen.
- **The `Submit decision` destructive branch is unverified by screenshot.** The button was proven
  amber with the default `No action` selected; proving the red branch needs a click, and the
  screenshot driver takes no interaction.
- **`Table` renders `w-auto max-w-full`, so the queue's rows stop well short of the full content
  column** while the chapter bands and the lower third above and below them span it. The mismatch
  is visible at 1440 and it is `src/components/ui/table.tsx`'s call, not this track's file to
  change. Whoever owns the table primitive should decide whether a v5 board table is full-width.
- **The dormant balance still draws as a bar.** `NOT_STARTED_DASH` at `display-lg` is an em rule
  the width of an em; `TowerFigure`'s `absent` branch makes it faint and gives it a spoken
  sentence, which is as far as an honest absence can be softened without shrinking the figure and
  breaking the promise that the dormant page teaches the shape of the live one.
- **`Panel` still titles every block with `EYEBROW`**, the sentence-case mono register, including
  on the operator pages. Converting those to `MICRO_LABEL` would have put the admin room out of
  step with every `Panel` in the product, and `panel.tsx` is not this track's file. The
  distinction the design system draws — an eyebrow labels a BLOCK, a micro-label is a key beside
  DATA — is the reason this was left alone rather than swept.
- **The flag detail page's `<h1>` is still the route label, "Flag detail".** Law 3 wants the
  question there ("The platform flagged a trade for a fairness review"), which is a string
  `QUESTION_FOR_FLAG_TYPE` already holds — but `FlagDetail` does not carry it, and
  `src/integrity/queue-view.ts` is shared domain outside this track's territory.
- **No `axe` run, no keyboard walkthrough.** Both are vitest/e2e work, deferred with the rest.
