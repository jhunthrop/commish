# The operator console — first design review (2026-08-27)

Seven surfaces under `/app/admin` — the dispute queue and its detail page, self exclusion, held
payouts, dissolve league, settle league, money reconciliation — shipped across Phase 4 Tasks 9–11,
Plan D Task 5 and Task 19, and **not one of them has ever been design-reviewed, mocked, or
persona-walked.** They were built as the back office of a product whose front of house has now had
three reviews. That framing is wrong twice over: the founder is this console's daily user, and
these are the only screens in the product that move real money in bulk, forfeit a member's
balance, reopen paid play for a self-excluded account, or close a league for good.

This is that review, in the same format and against the same bar as
`docs/research/2026-08-26-draft-room-design-review.md`,
`docs/research/2026-08-26-mock-lobby-review.md` and
`docs/research/2026-08-26-mock-results-review.md`: "most premium experience in the fantasy
world... sleek, modern, beautifully simplistic but high information density... maximize full
screen width... most efficient workflows... best app I've ever seen or used."

**An operator surface is a user-visible surface.** Plan B ruling 27 already says so, and
`held-trade-detail.tsx`'s own docblock quotes it: "it gets the full state coverage, the axe pass,
the keyboard walkthrough and 360px every other room surface does." The six rules apply here
exactly as written. Nothing below asks for a bootstrap admin panel's dispensation, and nothing
below is graded on a curve.

## Method

Judged the real rendered pages, not the code's intentions. The real built app at
`http://localhost:3102` (branch `worktree-ive-campaign`, HEAD `4da6f8a`), driven with
Playwright/Chromium against a freshly minted lab session (`Commish Lab`,
`user_01M11R35KJFR684JRM5A95FJQR`) granted operator access through the only door that grants it
(`scripts/grant-admin.ts`, ruling 15). Real Postgres, real SSR reads, real seeded integrity flags
— four open ones from the seed arcs: an account-pair flag, a fairness-review trade flag and two
held trades. Geometry, computed styles, landmark counts, tab order, ink-pill counts, dialog counts
and font-family sweeps read out of the live DOM rather than eyeballed. Both themes captured at
1680; 360 spot-checked on four surfaces. `axe-core` 4.x run against `<main>` on all eight page
states, in both themes, at `wcag2a/2aa/21a/21aa/22aa`.

**Nothing destructive was adjudicated.** The shared dev database took no dissolve, no settle, no
hold outcome, no exclusion clear and no flag resolution. Two states were exercised deliberately
and provably safely: the dissolve form's Enter-key path was fired with an EMPTY id field, which
short-circuits before any `fetch` (network log confirms **zero non-GET requests**), and the held
trade's Block confirmation modal was opened (a `setConfirming` state change, no request) and
screenshotted, never confirmed. Read-only otherwise: no source file changed, no commit, no server
touched.

Shots and scripts (this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/`,
prefix `revF-`.

## Executive verdict

The founder's own console is the least designed surface in the product, and the one place that
matters most: four of its five write surfaces move money or reopen regulated play, and **not one
of them asks a question before it acts** — measured, `dialogCount: 0` on every control page, with
a bare `<input>` in a `<form type=submit>` so that pressing **Enter** in the League id field
dissolves a league and refunds every member, and on Held payouts one Tab separates paying a
member from confiscating their balance, both one-way, both silent. The only surface in the cluster
that DOES confirm is the held trade, the one decision that moves no money at all. Beneath that,
the forms are write-only: an operator pastes a 36-character UUID into a field stretched to 1584px
on a page that is 71% empty, and learns what they just did — how many members, how many dollars —
only from the past-tense sentence that appears after it is irreversible. And the accountant's
page is not one: zero `font-mono` anywhere in the cluster (measured 0 on all six page surfaces),
two figures buried inside one muted sentence, no cents column, no as-of instant, no named checks,
and the `drift` number the API returns and the page is literally named for is fetched and thrown
away — so a book holding nothing and a book balanced to the cent print the identical green
sentence. A tight fix pass gives the four one-way acts a read-then-confirm, fixes a both-themes
1.07:1 contrast failure on the very number a held-trade decision turns on, and makes reconcile
tabular; the composition pass is where seven URLs sharing a prefix become an operator room.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT (safety) | HIGH | **The four dangerous acts telegraph nothing.** Measured: `[role="dialog"]` count is **0** on exclusions, holds, dissolve, settle and reconcile. Dissolve and Settle are `<form>`s whose only control is `type="submit"`, so **Enter in the id field fires them** (proved live with an empty field: alert "Enter the league's id.", zero non-GET requests). On Held payouts, `Release hold` is the submit and `Confiscate hold` is the next Tab stop — one keystroke apart, both one-way, both money. Every one of these docblocks argues the confirm away on *idempotency* ("the worst a mis-click costs is one honest error message"), which answers the wrong question: the risk is not a double press, it is a **first press on the wrong id**, which is precisely what a paste-a-UUID form maximizes. `HeldTradeDetail` already ships the right pattern — a `Modal`, focus on Cancel, a destructive Confirm — for the one decision here that moves no money | `dissolve-league-control.tsx`, `settle-league-control.tsx`, `holds-control.tsx`, `exclusion-control.tsx` | Route all four through `HeldTradeDetail`'s own `ConfirmModal` shape, extracted to one place; no one-way act submits on Enter |
| D2 | DEFECT (a11y) | HIGH | **The held trade's decisive number is invisible, in both themes.** `TradedPlayerList` puts `text-text-muted` on the `pts/wk` span *inside* a `Sticker` whose fill is the position pigment: measured **1.07:1** in dark (`#98989f` on `#df867e`) and **1.15:1** in light (`#68686d` on `#b35750`), **10 nodes**, axe `color-contrast` serious, both themes — the only axe violation in the whole cluster. `Sticker` supplies its own on-fill role (`text-pos-*-on`); this overrides it with a page-ground role. The number that is unreadable is the per-player valuation the fairness decision rests on | `src/admin-room/components/held-trade-detail.tsx` (`TradedPlayerList`) | Use the sticker's own on-fill text role for the value; a ground text role never lands on a pigment fill |
| D3 | DEFECT (honesty) | HIGH | **The forms never say what they are about to do.** Dissolve, Settle, Holds and Exclusions take an opaque id and act. Not one of them echoes the league's name, the member's name, the seated count, the escrow balance, the prize table or the held amount — every one of which the server already computes, and three of which it returns *in the success body* (`refundedMembers`/`totalRefundedCents`, `prizesPaidCents`/`heldCents`/`rakeCents`, `amountCents`). The operator learns the size of the thing **after** it is irreversible. Settle is the worst case: twelve UUIDs typed into a plain textarea where **line order is prize order**, no name beside any of them, no preview of who gets paid what | all four control components | A pre-flight read (`GET`) that names the object and states the exact consequence, then the confirm from D1 |
| D4 | DEFECT | HIGH | **The page named for drift does not print the drift.** `ReconcileDriftBody` declares `readonly drift: number`, the route returns it, and the component destructures it nowhere — the only rendered figures are ledger and bank, inside one prose sentence. Worse, "No drift found. The ledger agrees with the bank, and every internal check is clean." renders in `text-positive` over a measured **`$0.00` / `$0.00`** book: an empty ledger and a ledger balanced to the cent are typographically identical. No as-of instant appears anywhere, though the subhead promises "Recomputed fresh on every load" | `src/admin-room/components/reconcile-drift-panel.tsx` | Print the drift as its own row, stamp the instant the report was computed, and distinguish "zero" from "balanced" |
| D5 | DEFECT | MEDIUM | **Five of the six surfaces have no route in.** `TopBar` renders exactly one operator control — an 18px shield, `aria-label="Queue"` — and exclusions, holds, dissolve, settle and reconcile are reachable only by typing a URL. Each page's docblock records this as a decision ("an operator reaches this page directly, from the support conversation"), and each cites the one before it, so a scoping note taken once has now propagated to five surfaces unexamined. The shield also carries **no count**, while `NoticeInbox` immediately beside it carries "1" — the member's inbox advertises its depth and the founder's queue does not | `src/components/app-shell/top-bar.tsx`, all five pages | An operator index at `/app/admin` with live counts, and one nav; the shield badges the open-flag count |
| D6 | DEFECT | MEDIUM | **The copy gate cannot see this cluster, and could not catch its one violation anyway.** The only two rendered contractions in the console are `"...and you can't undo it."` in BOTH `ConfirmModal` bodies — the exact sentences carrying the irreversibility warning, and C1 bans contractions. `copy-rules.ts`'s `CONTRACTIONS` alternation lists `ain't|won't|shan't` plus `(is\|are\|was\|were\|does\|do\|did\|has\|have\|had\|could\|would\|should\|might\|must\|need\|dare)n't` — **`can't` is in none of them** (verified: the regex returns `null` on "you can't undo it"). Separately, `copyViolations` is never applied to a single string in `src/admin-room/**` or `src/app/app/(shell)/admin/**` | `src/integrity/copy-rules.ts`, `held-trade-detail.tsx` | Add `ca` to the `n't` alternation; sweep the operator cluster's rendered strings like every other surface's |
| E1 | EXECUTION | HIGH | **Reconcile is prose where it should be a book.** Measured **0 `.font-mono` elements** on the page (and 0 across every page-level surface in the cluster; the only mono anywhere is 3–6 `EYEBROW` labels on the two detail pages). Both figures live inside one `text-sm text-text-muted` sentence — "Ledger pooled balance $0.00. Bank pooled balance $0.00." — proportional, unaligned, no cents column, no ledger-vs-bank pairing, no total row. `font-mono` carries `tabular-nums` in this product specifically so a money column cannot shift; the money page is the one page not using it | `reconcile-drift-panel.tsx` | A two-column mono statement: ledger, bank, drift, each check named with its own pass/fail |
| E2 | EXECUTION | HIGH | **The composition does not use the screen, and stretches the one thing that needed a measure.** Measured at 1680×1000: content ends at **y=252** (reconcile), **y=288** (exclusions, holds, dissolve) and **y=460** (settle) — **71–75% of the viewport empty** — while the 36-character UUID `<input>` is **1584px wide** on all four, and settle's standings `<textarea>` likewise. The full-bleed law governs frames; it never asked a one-line id field to span a 1680px screen. This is the composition tell: nobody laid these pages out, the elements simply fell down the left edge | all four control pages | Give the console a real composition: the object under review on the left, the act on the right, the field a measure of its own |
| E3 | EXECUTION | HIGH | **The queue's widest column restates what the icon already said.** Measured: the `Question` column is **692px**, and 3 of 4 rows open with the identical words "The platform flagged/held a…", so the discriminating word lands at character 14 or later. The icon column already carries the flag kind (`ICON_FOR_FLAG_TYPE`). A dense table's job is to make four rows differ at a glance; these four are near-identical sentences | `src/admin-room/components/queue-table.tsx` (`COLUMNS`) | The question becomes a short key ("Duplicate accounts", "Lopsided trade", "Trade held"); the sentence lives on the detail page |
| E4 | EXECUTION | MEDIUM | **"Waiting since" prints a date, not a wait.** Measured, all four rows: `Aug 23, 2026, 11:56 AM` — four days old today, and the column never says so. The operator's actual question is how long this has sat, and `formatCoarseDuration` (`@/components/ui`) is already the product's answer to exactly that sentence on the wire and in `WaitingRoom`. The timestamp is also not mono, so the column does not align | `queue-table.tsx` (`formatWaitingSince`) | Coarse age as the value ("4 days"), mono and tabular; the absolute instant in the `<time>` tooltip it already has |
| E5 | EXECUTION | MEDIUM | **The queue never names the league.** `flagDetail` reads `detail.leagueId` and the detail page resolves it to a name (`leagueNameFor`) — the queue's four columns are icon, question, about, waiting-since. An operator cannot see from the queue that three of four flags belong to one troubled league, which is the single most useful pattern a dispute queue can surface | `queue-table.tsx`, `listPendingFlags` | A league column, and rows for the same league visibly grouped |
| E6 | EXECUTION | MEDIUM | **Queue depth appears nowhere.** `<h1>Dispute queue</h1>` carries no count; the top bar's shield carries no badge; there is no total, no "4 open", no age of the oldest. The founder cannot answer "is there anything waiting" from any screen without loading the queue | `admin/queue/page.tsx`, `top-bar.tsx` | The count beside the title and on the shield |
| E7 | EXECUTION | MEDIUM | **The Evidence card is a debug dump.** Raw camelCase keys and `JSON.stringify` values rendered into a `dl`: `basis "accept_evaluation"`, `flags ["value_gap_over_threshold"]`, `verdict "lopsided"`, `givingValue 82.07`. On the account-pair flag it is worse — **`ip 0`, `total 0.8`, `device 1`, `behavioral 0.5`** — four bare scores with no scale, no threshold and no words, on the one flag type that has no content, no reporters and no trade to read instead. The console's hardest decision is shown the least evidence, in the least readable form | `admin/queue/[flagId]/page.tsx` (Evidence card) | Human labels and units for the keys the product actually raises; the raw object behind a disclosure |
| E8 | EXECUTION | MEDIUM | **A radio group with one option is a formality.** Measured on the account-pair flag: `radios: ["no_action"]`. The operator loads a 625px page, tabs past four cards, selects the only choice and presses Submit — to record that they looked. A single-option decision is not a decision, and the whole page shape assumes several | `admin/queue/[flagId]/page.tsx`, `resolution-form.tsx` | When one decision is offered, render it as one named act ("Close with no action"), not a radio group |
| E9 | EXECUTION | MEDIUM | **No way back, and no way onward.** Measured: **0 links inside `<main>`** on all three detail pages — no "Back to the queue", no "Next flag". Clearing four flags means four browser-backs or four trips to an 18px shield in the top bar. The console has no notion of a queue being *worked* | `admin/queue/[flagId]/page.tsx`, `held-trade-detail.tsx` | A back link and a "next open flag" on every detail page |
| E10 | EXECUTION | MEDIUM | **Ten full-width color banners on the money surface.** `TradedPlayerList` renders each player as a `Sticker` stretched to **768px**, so the held-trade page is the loudest color field anywhere in the product — and rule 1 governs it hardest: green means money and red means live, and here green is RB and red is QB, on the page where an operator decides money. LED-2 desaturated the position pigments precisely because "a full-cell sticker fill at semantic-role saturation reads as a spreadsheet, not a board"; a 768px fill undoes that at scale. A sticker is a board cell, not a banner | `held-trade-detail.tsx` (`TradedPlayerList`) | `PositionBadge` beside a plain row; the sticker fill stays on the board where it means something |
| E11 | EXECUTION | LOW | **Rule 5's one ink action is spent on Refresh.** Measured `bg-text-primary` count = 1 on reconcile, and it is the button that changes nothing. On a page that reports a number, the loudest control is "load the number again" | `reconcile-drift-panel.tsx` | Refresh is a quiet pill; if the page has no ink act, it has none |
| E12 | EXECUTION | LOW | **Every page's tab title is "Commish."** Measured `document.title` on all six surfaces: identical. An operator working with the queue, holds and reconcile open cannot tell three tabs apart | the six admin `page.tsx` files | Per-page `metadata.title`, the same discipline any multi-tab console holds |
| E13 | EXECUTION | LOW | **"member(s)".** `dissolve-league-control.tsx` composes `${n} member(s) were refunded ${amount}` — a parenthetical plural, in the one sentence that tells the founder how many people just got their money back. `held-trade-detail.tsx`'s own `seasonWord` shows the house already knows how to do this. The same sentence is also passive ("were refunded"), which `copy-rules.ts` bans by name — and, per D6, never sweeps here | `dissolve-league-control.tsx` | Real pluralization, active voice: "We refunded 9 members $450.00." |
| E14 | EXECUTION | LOW | **The clear-queue empty state points out of the console.** "The queue is clear." is well-worded and correctly distinguished from "nothing is happening" — and its one action is "Go to your leagues." The single moment the console has the founder's attention with time to spare, it sends them to their fantasy teams rather than to the drift report or the held payouts | `queue-table.tsx` (`EmptyState`) | The clear queue offers the console's own next thing |
| R1 | DIRECTION | HIGH | **There is no operator console — there are seven pages that share a URL prefix.** No index, no nav, no cross-links, no shared shape (two read surfaces, four write-only paste-an-id forms, one hybrid), no tab titles, no counts. And the chrome around them is a fantasy manager's: the tab walk on the dispute queue passes **"Join or create another league"** in the rail before it reaches the first flag. The founder adjudicating a collusion report is being sold a league. This is the cluster's root finding and most of the E-list is downstream of it | all of `src/app/app/(shell)/admin/**` | One operator room: an index with live counts, one nav, one page shape, and chrome that knows what it is |
| R2 | DIRECTION | HIGH | **Every dangerous act should be read-then-confirm, and the product already knows how.** `ResolutionForm`'s `previews` prop is the exact idea — show the operator the literal words the member will read before they send them — and it is the best-designed thing in the cluster. `HeldTradeDetail` is the other half: the object in full, then a modal that names the consequence. The four money surfaces get neither. Settle in particular should render the league's own prize table with names against places, and the escrow it is about to close, **before** it pays it | the four control components | Extract the confirm; give each control a pre-flight read; the act names itself on the button, never "Confirm" |
| R3 | DIRECTION | HIGH | **Make reconcile the accountant's page it claims to be.** Today it is a title, a sentence, a white pill and two prose figures ending at y=252. It should be a statement: ledger and bank in a mono two-column with a drift row that shows the sign and the cents; each internal check named with its own pass/fail rather than the collective "every internal check is clean"; an as-of instant; and a real distinction between a zero book and a balanced one. The founder will read this page every day of the season and it is currently four sentences | `reconcile-drift-panel.tsx` | A statement, not a sentence |
| R4 | DIRECTION | — | **The queue is a triage surface with no triage.** Everything is one flag deep, one page load at a time, with no way back. The detail page's own `lg:sticky` read/decide split already proves the shape works — bring it to the list: a row expands, the evidence is in view, the decision is beside it, and clearing four flags is four decisions rather than four navigations. Ruling 30 (oldest first, no severity sort) is untouched by this and should stay untouched | `queue-table.tsx`, `admin/queue/[flagId]/page.tsx` | Expand-in-place triage, decision beside evidence, no page load per flag |
| R5 | DIRECTION | — | **Where is the Sunday Standard's signature?** Zero mono across the cluster's six page surfaces, no wire, no density outside the one queue table, no color spent on money on the one cluster that IS money. The lobby review and the results review both ended on this finding; this cluster earns it hardest, because the queue table (dense 41px rows, hairlines, near-monochrome, honest subhead, a designed empty state) proves the house can do it — and then five sibling pages do not | all of `src/admin-room/**` | One mono band of the console's own real facts: queue depth, oldest wait, held total, drift |

Counts: **6 DEFECT · 14 EXECUTION · 5 DIRECTION.**

## What was measured (and what it says)

Every number below read from the live DOM at 1680×1000, dark, against the real seeded data.

| surface | content ends at | viewport used | `.font-mono` | ink pills | `[role=dialog]` | links in `<main>` |
|---|---|---|---|---|---|---|
| `/admin/queue` (4 flags) | 353px | 35% | 0 | 1 | 0 | 4 (the flags) |
| `/admin/queue` (clear) | 344px | 34% | 0 | 1 | 0 | 1 ("Go to your leagues") |
| `/admin/queue/[flagId]` (pair) | 625px | 63% | 6 (eyebrows) | 1 | 0 | **0** |
| `/admin/queue/[flagId]` (trade) | 970px | 97% | 6 (eyebrows) | 1 | 0 | **0** |
| `/admin/queue/[flagId]` (held) | 1068px | 107% | 3 (eyebrows) | 1 | 0 | **0** |
| `/admin/exclusions` | 288px | 29% | **0** | 1 | **0** | 0 |
| `/admin/holds` | 288px | 29% | **0** | 1 | **0** | 0 |
| `/admin/leagues/dissolve` | 288px | 29% | **0** | 1 | **0** | 0 |
| `/admin/leagues/settle` | 460px | 46% | **0** | 1 | **0** | 0 |
| `/admin/money/reconcile` | 252px | 25% | **0** | 1 (Refresh) | **0** | 0 |

Three readings. **The console is empty screen.** Five of ten states use under half the vertical
they are given, on a 1616px `<main>` whose only occupant is a 1584px text field. **The console has
no mono.** The four surfaces that exist to report money have none at all, and the two that have
any have it only on section labels. **The console has one modal, and it guards the wrong thing** —
a held trade, which moves no money — while dissolve, settle, confiscate and clear-exclusion have
none.

The rule-5 ink count is genuinely correct everywhere (exactly one per view, every time), which is
worth saying plainly: the pill discipline holds in the one place nobody was watching. Rule 3 holds
too — no capitals anywhere in the cluster. Rule 4 holds: hairlines, no card borders drawn heavy.
360 is clean on all four spot-checked surfaces, with no horizontal overflow and no element past
the fold line. Light is designed, not inverted. The gates that could be automated worked. What
failed is everything a gate cannot see.

## The per-state walk

**S1 · The dispute queue, 1680, dark.** The best surface in the cluster and the only composed one:
41px rows at 12.5px, hairline separators, sentence-case mono headers, and a subhead that states
its own discipline honestly ("Oldest first. Nothing here is ranked by how serious it looks.") —
that is ruling 30 spoken aloud instead of hidden, and it is exactly right. Then the eye stops: 3
of 4 rows begin with the same five words (E3), the "Waiting since" column shows a date instead of
a four-day wait (E4), no league appears anywhere (E5), no count (E6), and 650px of the screen is
empty below the fourth row. To the left, the member rail offers a "+" to join another league.

**S2 · The clear queue.** Designed first, not bolted on, and it says so in the code. "The queue is
clear." reads differently from "nothing is happening," which is the distinction an operator
actually wants. Its one action then sends them to their fantasy teams (E14).

**S3 · A flag detail, ordinary subject.** The two-column `lg` split — evidence left, sticky
decision right — is the right shape and holds up at 1680. The decision column is the best-argued
component in the cluster: `previews` shows the operator the literal notice the member will read,
`ContentRemovedPreview` warns them their words are NOT what gets quoted, `no_action` previews
silence. That is craft. Beside it the evidence card prints `verdict "lopsided"` and
`flags ["value_gap_over_threshold"]` (E7), and on an account-pair flag it prints four bare
decimals with no scale (E7) beside a radio group with one option (E8). There is no way back to the
queue (E9).

**S4 · The held trade.** The most information-dense page in the console and the most damaged. Both
managers' standing, both sides valued, the trail, the gap sentence, two named acts and a real
confirmation — the composition is right. Then: ten position stickers stretched to 768px turn the
page into a color field (E10), and on nine of them the `pts/wk` value — the number the whole
decision rests on — measures **1.07:1** and simply cannot be read (D2). The confirm modal that
follows is well built (focus lands on Cancel, destructive Confirm, Esc closes) and its body says
"you can't undo it," a contraction the house banned and the house's own sweep cannot see (D6). No
league name appears on the page. No dollar stake appears on a page about a paid league.

**S5 · Dissolve, Settle, Holds, Exclusions.** Four variations of the same non-page: a title, a
sentence, one or two boxes stretched the full 1584px, one pill, and 700px of nothing. Each one is
irreversible. None of them names its object, previews its consequence, or asks. On Held payouts
the two exits sit side by side — ink "Release hold", red "Confiscate hold" — one Tab apart, with
the Enter key wired to the first (D1).

**S6 · Money reconciliation.** A page for the founder's daily money check that is four sentences
tall. "Refresh" is the loudest thing on it (E11). The two balances sit inside a muted paragraph,
proportional and unaligned (E1). The drift figure the API returns is not rendered at all (D4).
"No drift found... every internal check is clean" prints green over `$0.00` / `$0.00`, with no
instant attached (D4).

**S7 · 360, all four spot-checked.** Clean: no horizontal overflow, no element past the viewport,
the queue table scrolls inside its own wrapper as `Table` promises. The mobile story is fine
because there is barely anything to lay out.

## The founder's first five minutes

He opens the app on a Tuesday to clear the weekend's disputes. Seconds 0–10: nothing on any screen
tells him anything is waiting; he clicks the shield he knows is there (D5, E6). Four flags. All
four say "The platform..." and all four say "Aug 23, 11:56 AM" — he does not learn from this page
that they have waited four days, or that three of them may be the same league (E3, E4, E5).
Minute 1: he opens the first, an account-pair flag. Four decimals, no scale, and one radio
option. He presses Submit to record that he looked (E7, E8), then hits browser-back because there
is no way out (E9). Minute 2: the held trade. Genuinely good page — both rosters, both managers,
the gap — except he cannot read a single player's weekly value on nine of ten rows (D2), so he
squints, gives up on the numbers, and decides off the 46.37 gap sentence alone. He blocks it. The
modal asks properly. That is the console's one good moment. Minute 3: support flagged a league
that never filled; he opens Dissolve, pastes the id from the Slack thread, and presses Enter out
of habit. Nine members are refunded. He finds out how many, and how much, from the sentence that
appears afterward (D1, D3). He does not know whether it was the right league until he checks. He
never had a chance to. Minute 4: reconcile. Two dollar figures inside a sentence, both zero, and a
green line telling him the book is clean — which it also says when the book is genuinely balanced,
and which he has no timestamp for (D4, E1). Minute 5: he closes the tab. Verdict: the console
worked, in the sense that a terminal works. Fix D1, D2, D3 and D4 and those same five minutes end
with him knowing what he did before he did it, and trusting the number when he sees it.

## Prioritized remediation

**Before the next real dollar moves through this console (the safety pass):**
1. **D1** — extract `HeldTradeDetail`'s `ConfirmModal` to one place and put it in front of
   dissolve, settle, release, confiscate and clear-exclusion. No one-way act submits on Enter.
   The button in the modal names the act; "Confirm" is not a word this product should use for
   confiscating money.
2. **D3** — a pre-flight read for each one: the league's name and seated count before dissolve;
   the prize table with names against places, and the escrow, before settle; the held balance and
   the member's name before either hold exit; the member's name and exclusion date before clear.
   `ResolutionForm`'s `previews` is the precedent and it is already this product's own idea.
3. **D2** — the sticker's on-fill text role for the value. Both themes, ten nodes, one class.
4. **D4** — print the drift, stamp the instant, distinguish zero from balanced.
5. **D6** — add `ca` to the contraction alternation; sweep the console's strings.
6. **E13** — real pluralization and active voice on the refund sentence.

**Then (the console pass, in order of leverage):**
1. **R1** — the operator index: one nav, live counts (open flags, oldest wait, held total, last
   drift), one page shape, and chrome that is not selling leagues.
2. **R3 + E1 + E11** — reconcile becomes a statement: mono, tabular, drift row, named checks,
   as-of, and no ink pill on Refresh.
3. **R2 + E2** — the control pages become read-then-act, which also solves the composition: the
   object under review occupies the screen the id field is currently stretched across.
4. **R4 + E9 + E3 + E4 + E5 + E6** — the queue becomes workable: short keys, league column, coarse
   ages, a count, expand-in-place, and a way onward.
5. **E7 + E8** — evidence in human words; a single decision rendered as a single named act.
6. **E10** — the sticker goes back to the board; the operator's page gets a badge and a row.
7. **E12 + E14** — tab titles, and an empty state that points into the console rather than out.

---

*Method footnote: all geometry, computed styles, landmark and dialog counts, tab order, ink counts
and font sweeps read from the live DOM of the real built app at `4da6f8a`, against a lab session
granted operator access through `scripts/grant-admin.ts`, over the real seeded integrity flags
(four open: one account pair, one fairness trade, two held trades). axe-core run against `<main>`
on eight page states in both themes. The shared dev database took no destructive write: the
Enter-key path was exercised with an empty field (network log: zero non-GET requests) and the
Block confirmation was opened and photographed, never confirmed. Read-only review: no source file
changed, no commit made.*
