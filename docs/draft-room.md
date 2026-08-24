# Commish — The Draft Room (client)

Read this with `docs/conventions.md`, `docs/design-system.md` and `docs/draft-engine.md`
before touching anything under `src/draft-room/` or the draft pages. The engine is pure, the
service owns persistence and publishing — and this layer owns **nothing but rendering and
synchronization**.

## The one rule

**No draft rule is implemented in React.** Turn order, eligibility, slot assignment, budget
and reserve math, clock tiers and deadlines all belong to `src/draft-engine/`. If a component
needs one of those values, the engine computes it and the server sends it.

This is enforced by lint, not by the type system. `eslint.config.mjs` scopes an
`@typescript-eslint/no-restricted-imports` rule to `src/draft-room/**/*.{ts,tsx}` (only that
directory — a filename alone can't tell a Server Component apart from a client one, so this
is the one glob that can't misfire) and bans VALUE imports of `@/draft-engine`,
`@/draft-service`, `@/db*` and `@/lib/realtime*` from anywhere under it. `import type` is
explicitly allowed by the same rule (`allowTypeImports: true`) — sharing a TYPE (e.g.
`DraftStateView`) costs nothing at runtime and is how the client and server sides of the wire
stay in sync. There is no build-time or bundler-level guarantee beyond that lint rule; it is
what makes "no engine function reachable from a browser bundle" true in practice.

**Pages are the deliberate exception.** `src/app/app/drafts/[draftId]/page.tsx` and
`src/app/draft/[draftId]/board/page.tsx` are Next.js Server Components — they run on the
server, never ship to the browser, and the no-restricted-imports rule does not (and should
not) apply to `src/app/**`. They MAY import `@/draft-service` (or `@/draft-engine`) directly,
the same way this codebase's existing API route handlers already do; that's idiomatic Next.js,
not a boundary violation. In this plan neither page actually needs to — both call
`requireCurrentUser()` and then hand off to a client component (`DraftRoom`, `TvBoard`) — but
the rule is scoped the way it is specifically so that a future server-rendered page under
`src/app/**` could, without needing a second lint carve-out. See "Draft room client boundary"
in `docs/conventions.md`.

The one place this rule was tested and held: `rosterSpots()` in `state/format.ts` sums the
league's declared slot counts. It is config arithmetic, not a draft rule, and its test asserts
it agrees with the engine's `totalRosterSlots` so the two cannot diverge.

The second place it was tested and held: **"You're up in 7 picks (~24m)."** Working that out
from `draftOrder` and `pickNumber` in React would be serpentine order restated — so the engine
publishes the answer instead. `upcomingOnClock` (see `docs/draft-engine.md`) puts the next
`DRAFT_VIEW_CONFIG.upcomingCount` teams on `DraftClockView.upcoming`, which rides every event
payload; `formatYourTurn(upcoming, myTeamId, clockSeconds)` in `state/format.ts` is then an
index lookup plus display arithmetic over two server values, and the dock renders its sentence.

## Layers

| Path | Rule |
|---|---|
| `src/draft-room/state/` | Pure. No React, no I/O, no clock. **100% coverage enforced** (`vitest.config.mts`). |
| `src/draft-room/hooks/` | React state + effects. Every external dependency (`fetch`, `EventSource`) is injected through `DraftRoomDepsProvider`, so tests use doubles rather than module mocks. |
| `src/draft-room/lib/` | Small pure helpers shared by components (currently: id→display-name lookups). No React, no I/O. |
| `src/draft-room/components/` | Presentational. They receive a `DraftStateView` and callbacks; none of them fetch. |
| `src/app/app/drafts/[draftId]/` | Authed server shell for the live room. |
| `src/app/draft/[draftId]/board/` | Authed server shell for the read-only TV board. |

## The synchronization contract

1. **Mount** → `GET /api/drafts/[draftId]` and `GET /api/drafts/[draftId]/players` in parallel.
   The state route returns the `DraftStateView`, the league's display name (`leagueName` —
   the one thing `RoomRail` needs that the view itself cannot supply), the caller's own
   `teamId`, whether they are the commissioner, and the league's team cards. The players route returns ranked player
   metadata, and is separate precisely because the state route is refetched often and the
   player dictionary never changes during a draft — `refresh()` (see step 4) fetches it
   **once per `draftId`**, not on every resync, and refetches only when `draftId` itself
   changes.
2. **Subscribe** → a native `EventSource` on `/api/leagues/<leagueId>/events`, opened only
   once the mount fetch has resolved a `leagueId`. From `useDraftRoom`'s own point of view this
   is unconditional — it always calls its injected `openEventSource(url)` — but by default that
   factory resolves to `subscribeLeagueStream` (`src/event-stream/league-stream.ts`), which opens
   a real `EventSource` only if nothing else is already subscribed to that same url; the chat
   band mounted alongside it (`docs/chat.md`, "Real-time") is typically the other subscriber, and
   the two share one connection. Nothing below this point changes because of that: `useDraftRoom`
   still gets its own `open`/`error`/named-event listeners and still resyncs on its own schedule.
   **The browser owns reconnect and `Last-Event-ID`.** There is no retry loop, no backoff timer
   and no polling anywhere in this codebase; adding one would be a bug, not a feature. **Every `open` resyncs the state view
   — the first one included, not only a reconnect's.** The stream only carries events
   published after it opens, and it opens after the mount snapshot has already resolved, so a
   pick or bid published in that window would otherwise sit unseen until the next event
   arrives; the first `open`'s resync closes that gap. A reconnect's `open` covers the
   analogous gap beyond stream retention. Because players are cached per `draftId` (step 4),
   every one of these resyncs is a single extra state fetch, never a full re-fetch pair.

   The stream carries **named SSE events**, not one generic `message` frame: `useDraftRoom`
   registers one listener per draft event type (`draft.pick`, `draft.nominate`, `draft.bid`,
   `draft.timer_expire`, `draft.status`, `draft.queue`, `draft.nudge`) via
   `source.addEventListener(type, handler)`, plus separate `open` and `error` listeners for
   connection state. `chat.*` and `score.update` frames ride the same stream under their own
   event names and are never listened for here — the draft room is not their consumer.

   **`draft.queue` and `draft.nudge` are the two frames that never move the picture.**
   `draft.queue` carries only `teamId` — the queue's own contents are never on the wire, since
   a queue is a private draft plan — and folds exactly like `draft.status`: the clock (and
   therefore `sequence`) advances, nothing else about `view` changes. This is what keeps a
   rival's queue edit from ever forcing a resync. The room's OWN `queue` — loaded with the
   snapshot, held separately from `view`, written by `setQueue` (below) — is never touched by
   any `draft.queue` frame, including an echo of the caller's own edit; the local, optimistic
   value stays authoritative until the POST's own response replaces it. `draft.nudge` carries
   `teamId` and `message` and moves nothing at all — `applyDraftEvent` surfaces it as a
   `NudgeNotice` alongside the (unchanged) view, and `useDraftRoom` keeps it only when
   `payload.teamId` matches the caller's own team. See `docs/draft-moderator.md`.
3. **Apply** → `applyDraftEvent(view, data)` (`src/draft-room/state/apply-event.ts`) validates
   the frame with Zod (`state/payloads.ts`), then compares `payload.clock.sequence` with
   `view.sequence`:
   - `< view.sequence` → ignore (already applied)
   - `=== view.sequence` → apply (a sibling of the transition just applied: `draft.timer_expire`,
     its `draft.pick`, and a trailing `draft.status` all share one sequence number)
   - `=== view.sequence + 1` → apply (a new transition)
   - `> view.sequence + 1` → **resync**
   Every apply is idempotent by content, so a redelivered sibling can never duplicate a pick.

   **`minBid` is assigned, never derived.** On `draft.nominate`, `draft.bid`, and the auction
   case of `draft.pick` (a lot closing), the reducer copies `payload.minBid` verbatim onto
   `view.minBid` — exactly the same way it copies `payload.budgets` and `payload.maxBids` on a
   pick. The client never computes `highBid + bidIncrement`; the engine already applied the
   auction's reserve/increment rules and sent the answer.
4. **Resync** → refetch the whole view. Triggered by a sequence gap, by a `draft.bid` against a
   lot we never saw open, by a `draft.nominate` on a non-auction view, and by **every**
   `EventSource` `open` — always, not only one that follows an `error`. (See step 2: the first
   `open` closes the mount→subscribe gap, a reconnect's `open` covers a gap beyond stream
   retention — same trigger, two different gaps.) This is the fallback `docs/conventions.md`
   names for a gap that outlasted the stream's retention window, and it is what makes a missed
   auction bid war and a budget desync self-healing.

   `refresh()` (in `use-draft-room.ts`) is **single-flight**: a burst of gapped frames arriving
   in the same tick all see the same in-flight promise and share one fetch pair rather than
   firing N. It is also **generation-guarded** — a `draftId` change bumps a generation counter,
   and a response for an old generation (however late it resolves) is discarded rather than
   applied, so navigating between drafts can never let a stale fetch write into the new
   draft's state. The hook's `draftId`-change effect is a hard reset: it clears the view, team
   id, league id and connection state back to `INITIAL` rather than showing the previous
   draft while the new one loads. And it is **players-cached**: `refresh()` only ever fetches
   `GET /api/drafts/[draftId]/players` once per `draftId` — every other resync (a gap, a
   missed bid war, an `open`) fetches state alone — refetching players again only when
   `draftId` itself changes, alongside the hard reset above.
5. **Submit** → `optimisticView()` patches the view for instant feedback, the POST goes out,
   and the response replaces the view — unless SSE already carried us further (compared by
   `sequence`), in which case the newer view wins. A rejected submission (409, or any
   non-`ok` envelope) rolls back and shows the reducer's own plain-language reason in a toast
   — **but only if nothing else happened while the request was in flight.** If the view's
   `sequence` has already moved past the pre-submit snapshot (the routine case in an auction
   bid war: someone else's bid landed over SSE before our rejection came back), rewinding to
   the pre-submit view would erase real, already-confirmed state — another team's pick, its
   money, its lot — so the rollback instead triggers a full `refresh()` and asks the server for
   the truth. Only a submission that landed with nothing else having happened gets the cheap,
   synchronous plain restore.
6. **`setQueue`** (`useDraftRoom`) follows the same optimistic-then-settle shape as `submit`,
   through `POST /api/drafts/[draftId]/queue` — but **a queue edit is not a draft action**: it
   never touches `pendingPlayerId`, `submitting`, `optimisticView`, or `view` at all. Only
   `queue` moves, optimistically, then settles on the server's own answer or rolls back with
   the reducer's 409 reason on rejection (`"A queue can hold at most 50 players."` and similar
   — the client enforces no length cap of its own; see `docs/draft-moderator.md`). `SnakeRoom`
   and `AuctionRoom` each call the shared `useQueueHandlers` hook
   (`src/draft-room/hooks/use-queue-handlers.ts`) rather than threading a queue callback down
   from `DraftRoom` — it wraps `room.setQueue` and turns a rejection into the same `tone:
   "error"` toast every other rejected action gets, so that wiring isn't declared twice.

### What "optimistic" deliberately does not do

`optimisticView` never guesses a roster slot, a round, a price, a budget or a turn change,
because each is a draft rule. What it does is specific to the action:

- **`MAKE_PICK`** removes the player from `availablePlayerIds` immediately, so `PlayerPool`
  renders that row as **drafted** (a `Badge`, no button) before the server has answered — the
  pool never shows a stale "still available" row for a player you just took.
- **`NOMINATE`** leaves the player in the pool but sets `pendingPlayerId`, so `PlayerPool`
  renders that row's action button as **pending** (`aria-busy`) instead. It also patches
  `view.auction` so the lot, opening bid and your team as high bidder appear at once.
- **`BID`** sets `pendingPlayerId` to the lot's player and shows the bid you just made as the
  new high bid.

Everything else waits the one round trip it takes for the truth to arrive.

## Wall clock

`useNow(intervalMs)` is the **only** place browser code reads `Date.now()`, and it exists
purely so countdowns tick. A countdown never decides anything: clock expiry is the server
ticker's job, and `TIMER_EXPIRE` has no HTTP path a client could use. `Countdown`/`useCountdown`
(`components/countdown.tsx`) is the one shared implementation of "milliseconds until
`deadlineAt`, clamped to zero, ticking on `DRAFT_ROOM_CONFIG.countdownTickMs`". `RoomRail`
is now its only caller: there is one clock in the room, on one surface.

## The commissioner's clock, and the platform's (Phase 3 Plan D)

The `scheduled`-mode room (the state before anyone has drafted a single pick) waits on
`drafts.kickoff_at` — a column that has existed since Phase 1 but, until this plan, was never
chosen, never shown and never compared to the clock by anything. Two things changed, both outside
this directory:

- **The commissioner can choose it.** `PUT /api/leagues/[leagueId]/draft-schedule`
  (`src/league-service/draft-schedule.ts`, `setDraftKickoff`) moves `kickoffAt` while the draft is
  still `scheduled`, refusing a caller who is not the league's commissioner with the same 404 (never
  403) `publicJoinPrecondition` and `withAdmin` already answer for an unauthorized caller — a
  schedule route that told a member "no" with a 403 would confirm which member holds the chair to
  anybody who could reach the league. The control itself lives on the league home page
  (`draft-schedule-panel.tsx`, `src/league-room/**`), not in this room — a draft that has not
  started yet has no room to control it from.
- **The platform presses start if nobody does.** `autoStartDueDrafts`
  (`src/draft-service/auto-start.ts`) starts any public matchmade league's draft whose scheduled
  kickoff has passed, through the IDENTICAL start path a commissioner's own button calls
  (`store.startDraft`) — one start implementation, not two. **The room cannot tell the difference,
  and is not meant to.** Whether `scheduled` mode gives way to `watching` because a human clicked or
  because the ticker claimed the guarded status transition first, `useDraftRoom` sees the same
  `draft.status` frame and the same resync path; `RoomRail`'s `data-mode` morph reads `view.phase`
  alone. A private league's draft is never auto-started, however late its commissioner runs —
  `enforcementAppliesTo({ isPublicMatchmade: true })` gates the scan before any row is even read,
  the identical platform-wide switch every other automated action in this plan asks.

See `docs/decisions/enforcement-and-tiers.md` §9 for the two schedulers this reasoning depends on
(the commissioner-chosen kickoff and the platform's own ticker) and why the audit-chain walk is a
different scheduler entirely, owned by a different phase.

## The two-mode room

A draft has two emotional modes, and the room morphs between them rather than making anyone
hunt for a control.

- **WATCHING** (roughly 95% of a draft) — the board is the stage. The two live anxieties are
  answered on screen at all times, without being asked for: *"when am I up?"* is the dock's
  standing `formatYourTurn` line, and *"will my guy last?"* is the queue chips beside it, with
  anybody already taken struck through.
- **PICKING** (about sixty seconds) — the room leans in. The rail goes hot (the negative
  family, the clock in the same red), and the dock's left edge becomes ONE primary button:
  *Draft &lt;top of your queue&gt;*. One click if you planned; two if you pivot, because the
  pool is already under your left hand.

### Layout contract (`RoomLayout`)

At `lg` and up the room is a `100dvh`, `overflow-hidden` frame with four regions:

| Region | Component | Size | Scroll |
|---|---|---|---|
| RAIL | `RoomRail` | fixed band (`lg:h-20`), full width | none |
| POOL | `PlayerPool` | fixed `lg:w-88` (352px) column, left | its own list scrolls |
| STAGE | `DraftBoard` | every remaining pixel | its own, and only when the board hits the sticker minimum |
| DOCK | `RoomDock` | fixed band (`lg:h-24`), **full width** | queue chips scroll sideways |

**The page itself never scrolls.** Every region that can outgrow its band scrolls inside
itself, and the two bands are fixed height, so a turn changing never moves the board a pixel.

Both fixed bands were re-measured against the dense type scale (Phase 3.6, Task 12 Step 2):
`TOKENS.font.sizeDense` only ever shrinks a size relative to the base scale it replaces at
`UI_CONFIG.shell.denseFromPx`, never grows one, so `lg:h-20`/`lg:h-24` stay generous rather than
tight — the SessionNotice room variant (Step 1b) trades a bordered strip for an inline pill,
which is narrower, not taller, so it fits the rail's existing row without widening the band.

The dock spans the **full** width rather than stopping at the pool's edge: it is the widest,
most reachable band on the screen, and running it to the left edge puts the primary action
directly beneath the pool you would pivot into — the shortest possible travel between "change
my mind" and "commit".

**Below `lg` it linearizes, it does not shrink**: the same four regions become one scrolling
column — rail, dock (sticky, so the action is always reachable), board (the existing per-round
list), pool — via `order-*` classes, so no region is ever rendered twice. Down to the 360px
baseline nothing scrolls horizontally except the board and the queue chips, each inside itself.

### The aside band: league chat

The room has a fourth region beyond the table above: an optional `aside` band carrying
`LeagueChat` (`src/chat-room/**`, see `docs/chat.md`). It follows the same scroll rule as the
pool rail (its own list scrolling inside itself), mirrored to the **right** edge with a left
border instead of the pool's right one. Width lives on the band's *content*, not the frame:
open it is the pool rail's width, and the **Hide chat** control collapses it to a slim strip
holding a vertical **Show chat** tab, handing the board those pixels back. A closed chat
unmounts — history is server-side, so reopening refetches through the hook's normal mount
path and nothing is lost. Below `lg` it linearizes **last** — after rail, dock and board — so
chat is never wedged between a manager and the board they're trying to watch.

It is built once, in `DraftRoom` (`src/draft-room/components/draft-room.tsx`), and passed down
as a prop exactly the way `bidConsole` and `poolFooter` already are: `DraftRoom` → `SnakeRoom` /
`AuctionRoom` → `RoomShell` → `RoomLayout`'s optional `aside`. That is why only `DraftRoom`'s own
test needs to wrap the tree in the chat deps provider — every component below it just renders
whatever node it was handed, with no idea a chat surface is even involved.

**The conversation is the league's, not the draft's.** `LeagueChat` is mounted with
`room.view.leagueId`, the same id the league home page uses, so it is the identical
conversation in both places — it survives the draft room closing, rather than starting over
empty the next time two managers argue about a pick.

Both draft pages are deliberately full-bleed: `src/app/app/drafts/[draftId]/page.tsx` and
`src/app/draft/[draftId]/board/page.tsx` dropped the centered `max-w-*` container and their own
`<h1>`. Every other app page keeps its container; a room is not a document. `RoomRail` renders
the league name as the page's only `<h1>`, which is also why `DraftBoard`'s narrow-list round
headings are `<h2>` — a jump to `<h3>` is a heading-order violation axe catches.

## The room's last moment now hands off (Phase 3.6, Task 12 Step 3b, D4)

`RoomRail`'s `complete` mode ("Draft complete. Every roster is final.") is still this room's own
last word — nothing here changed. What changed is where the manager goes next: `commitDraftResults`
(`src/draft-service/commit.ts`) writes the drafted roster and the Week 1 schedule in the SAME
transaction that closes the draft, and the redirect after a completed draft already lands on
league home, not back in this room. `LeagueHome`'s own `DraftCompleteArrival`
(`src/league-room/components/league-home.tsx`) is what puts those two facts — the fifteen players
just drafted, and the Week 1 opponent — in front of the manager at the moment they mean the most,
derived from fields `leagueHome` already returns (`draftStatus`, `currentWeek`, `myMatchup`, the
same `lineup` `LineupEditor` reads), no new query and nothing stored. See that component's own
docblock for the exact derivation and why it stops rendering itself once the season has a result.

## Components inventory (`src/draft-room/components/`)

| Component | Renders |
|---|---|
| `DraftRoom` | The client entry point for `/app/drafts/[draftId]`. Owns the loading/error/ready split and is the one place a rejected `submit()` becomes a toast. Picks `SnakeRoom` or `AuctionRoom` by `view.format`. |
| `RoomLayout` | The four-region frame above. Presentational and format-agnostic: it takes `rail`/`pool`/`stage`/`dock` nodes and owns the height, the scroll boundaries and the mobile re-ordering. |
| `RoomShell` | `RoomLayout` wired up with `RoomRail`, `PlayerPool`, the stage (`NudgeBanner`, pick-celebration, `DraftBoard`) and `RoomDock` — the one frame `SnakeRoom` and `AuctionRoom` both render. Everything format-specific is a prop: `actionLabel`, `onAct`, an optional `poolFooter` under the pool, an optional `bidConsole` for the dock. |
| `SnakeRoom` | `RoomShell` with `actionLabel="Draft"`, no `poolFooter`, no `bidConsole`. Reads `room.queue`/`room.nudge` and calls `room.setQueue` directly via `useQueueHandlers` — no queue props threaded from `DraftRoom`. |
| `AuctionRoom` | `RoomShell` with `actionLabel="Nominate"`, `BudgetTable` as its `poolFooter` (money sits under the players you would spend it on), `BidControls` as its `bidConsole` while a lot is live, plus `NominateModal` rendered alongside the shell. Same `useQueueHandlers` wiring as `SnakeRoom`. |
| `RoomDock` | The personal band: the manager's own queue as reorderable chips (`<ol>`, because position IS the meaning; named move/remove buttons, never drag-only; a player somebody has since taken is struck through, not dropped), their own roster fill per slot type, and `formatYourTurn`'s standing "You're up in N picks" line. On your turn its left edge becomes the single primary action — *Draft/Nominate &lt;top of your queue&gt;*, or a pointer at the pool when nothing queued is still available. It renders whatever `bidConsole` it is handed instead, which is how the auction's live lot turns the dock into a bid console without the dock knowing what an auction is. |
| `NudgeBanner` | The moderator's prompt, verbatim, `role="status"`/`aria-live="polite"`. Renders only while `nudge.sequence === view.sequence`, so it clears itself the instant the turn moves on — no timer, nothing to leak. One surface, not two: a banner, never a toast as well. |
| `TvBoard` | The read-only `/draft/[draftId]/board` shell, and the room's **stage alone**: `RoomRail` (`variant="tv"` — no team chip, no my-turn heat, because nobody across a room is "you"), pick-celebration, a "Now picking" portrait spotlight, and `DraftBoard` (`variant="tv"`). No pool and no dock: nobody acts from the other side of a living room. Shares `useDraftRoom` with the real room — no second data path. Renders no control except the error state's retry. Read from across a room (Phase 3.6, Task 12 Step 3): both `RoomRail` and `DraftBoard` take the `xl` display scale on this variant, the countdown steps up to its largest size, and `xs` never appears anywhere on either component's own authored labels — only the shared `Badge`/`Avatar` chrome beside them keeps its ordinary fixed size (see `room-rail.tsx`'s `RAIL_EYEBROW` docblock for the stated carve-out). |
| `DraftBoard` | **The hero.** Teams across, rounds down, one position-colored sticker per pick, from `view.picks`/`view.slotConfig`/`view.draftOrder` alone. A semantic `<table>` scrolling sideways in its own container above `sm`; below it, the same board as a per-round list, newest round first. The on-the-clock cell gets an accent ring (breathing, or static under reduced motion); the pick that just landed gets `animate-sticker-slap`. `variant="tv"` is the same board at party scale — see `TvBoard`'s own row for the Task 12 Step 3 "no `xs`" rule this variant also holds to. |
| `RoomRail` | The masthead, and the ONLY clock in the room: league name (the page's `<h1>`), format chip, `ROUND X · PICK Y` (or `LOT N`), whose turn it is, the countdown digits, the tightening line, your team chip, a quiet `ConnectionBanner`, and `SessionNotice` (`variant="room"`, Task 12 Step 1b — a compact, borderless pill that reads as `ConnectionBanner`'s sibling instead of `TopBar`'s bordered strip, same copy and escalation). It publishes its morph as `data-mode` — `scheduled` / `watching` / `hot` / `complete` — and `hot` recolors the band and the digits into the negative family. It replaced `RoomHeader`, having already absorbed `ClockBanner` and now `AuctionLotPanel`: the standing bid and its holder are a fact about *the turn*, and the turn has exactly one home. |
| `Countdown` / `useCountdown` | The one shared countdown implementation (see "Wall clock" above). Its ticking digits are `aria-hidden`, paired with an `sr-only`/`aria-live="polite"` SIBLING span that states the same time coarsely — the live region must sit outside the `aria-hidden` span, not inside it, or an `aria-hidden` ancestor hides it from assistive tech regardless of `sr-only`. |
| `PlayerPool` | The left rail: name search, the six positions as `PositionBadge` toggles (`aria-pressed`, one tap to narrow, one to clear), and one compact 44px row per player — rank, sticker, name, NFL team, a ☆ queue toggle and the act button. A list rather than a `Table`: at rail width there are no columns worth aligning. Caps rendered rows at `DRAFT_ROOM_CONFIG.poolPageSize` and never re-ranks. **Before the draft starts (`view.phase === "scheduled"`) no row is marked "Drafted"** — the engine has no pool yet, so `availablePlayerIds` is empty, and reading that as "everyone is gone" was the room's most confusing bug. Pre-start rows are browsable and queueable, with a quiet "—" where the action button goes. |
| `BidControls` | The bid form, and the dock's primary slot while a lot is live. `view.minBid` is the floor and `view.maxBids[myTeamId]` is the ceiling — both server-computed, never re-derived. A row rather than a stack, so it fits the dock's fixed band. |
| `NominateModal` | Confirms a nomination (it commits money) before submitting `{ type: "NOMINATE", playerId, openingBid }`. |
| `BudgetTable` | Remaining budget and ceiling per team, read straight off `view.budgets` / `view.maxBids`; own-row highlighted. The last `Table` consumer in the product to converge on dense padding (Phase 3.6, Task 12 Step 3c) — `Table` itself now defaults to `density="dense"`, so this renders it by saying nothing at all. |
| `PickCelebration` | The pick-landing announcement, `role="status"`, keyed on `pickNumber` — a redelivered pick never re-animates; a NEW pick remounts and replays the entrance. Since Plan D it is a thin caller of the shared `Celebration` primitive (`animate-celebrate-self` / `-peer`, see `docs/design-system.md`); the board still slaps the landing sticker, and reduced motion drops the animation class while keeping the panel. |
| `ConnectionBanner` | Renders nothing when `connection === "live"`; a small `aria-live="polite"` badge for `"connecting"` / `"reconnecting"`. Information, not a control — the browser reconnects on its own. |

### What the board deliberately does NOT compute

`DraftBoard` and `RoomRail` both need "which round is this team on" and the board needs
"which way did this round run". Neither is re-derived from a turn-order rule — that would be
`snakeTeamForPick` restated in React, which "the one rule" above forbids:

- **The round a team is about to fill** is `their pick count + 1` — the first empty row in
  their own column. It is a count of what already happened, not a prediction.
- **A round's serpentine direction** is read off the pick numbers already in that round:
  whichever team owns the round's lowest pick number sits earlier in `draftOrder` → the arrow
  points forward, otherwise back. A round with fewer than two picks gets **no arrow at all**
  rather than a guessed one, and an auction never gets one, because an auction "round" is a
  count of players won, not an order.
- **"When am I up?" is not computed here either** — it is `upcomingOnClock`'s answer, riding
  `view.upcoming`, turned into a sentence by `formatYourTurn`. See the top of this document.

`src/draft-room/lib/lookups.ts` — `teamsById` / `playerName` / `teamName`: the one place a
`teamId`/`playerId` is turned into the human it names, built once per render and shared by
every component above that needs it, instead of each component re-declaring its own
`.find(...)`. This file is a thin re-export of `src/lib/display/lookups.ts`, which the league
room does NOT need — its pages render names straight off the server-shaped view (e.g.
`MatchupSide.teamName`) instead of resolving ids client-side, so it has no lookup module of its
own. `queueButtonLabel` stays local to `src/draft-room/lib/`: it is draft-room-only vocabulary
(the pool's star and the dock's chips share its phrasing), and the league room has no queue.

## Accessibility notes specific to this room

- Countdowns' ticking digits are `aria-hidden` — a number changing every second inside a live
  region is unusable with a screen reader. Each is paired with a coarse `aria-live="polite"`
  sibling (rounded to the minute/hour, so it announces rarely instead of every tick), plus a
  static sentence stating the same time in words that differs by caller.
- The pick-landing panel is `role="status"` — announced once, politely.
- Toasts carry the failure channel: `tone: "error"` also sets `role="alert"`, because a user
  on a clock cannot wait behind a polite announcement queue.
- The TV board renders **no controls at all** except the retry on its error state.

## Follow-up: browser e2e (`e2e/draft-room.spec.ts`) — NOT part of this plan

Everything above is covered by unit and component tests with injected `fetch`/`EventSource`
doubles. A real end-to-end pass — a browser, the real SSE route, the real Redis stream — is
still worth having, and is deliberately deferred:

- **Playwright is not a dependency of this repo** (`package.json` has no `@playwright/test`,
  and there is no `e2e/` directory or `npm run e2e` script). Adding a browser runner is its
  own change with its own CI cost.
- **It needs WorkOS credentials.** Sign-in is hosted by WorkOS AuthKit; there is no local
  password path to script, so the test needs a real test-tenant user plus
  `WORKOS_CLIENT_ID` / `WORKOS_API_KEY` / `WORKOS_COOKIE_PASSWORD` / `NEXT_PUBLIC_WORKOS_REDIRECT_URI`
  in the environment. Those secrets are not available at plan time.
- **The seam is already prepared.** `npm run seed` with `DEV_SEED_CLAIM_USER_ID=<your WorkOS
  user id>` hands that user team 1 and the commissioner's chair in both
  `dev_league_snake` and `dev_league_auction` (see `src/data/seed/config.ts`), so the e2e has
  a real league to drive as soon as credentials exist.

**When it is written, it should cover:**

1. Sign in as a dev user via the `DEV_SEED_CLAIM_USER_ID` seam (seed a test-tenant WorkOS user
   into team 1 / commissioner of `dev_league_snake`, then drive the hosted sign-in flow for
   that user).
2. Open `/app/drafts/dev_draft_snake` in two separate browser contexts (two "teams" at the
   draft). Make a pick as one; assert the other's board, dock roster fill and `PlayerPool` all
   update without a reload.
3. Repeat against `dev_draft_auction`: run a bid war between the two contexts — nominate,
   alternate bids, assert the rail's high bid/bidder and `BudgetTable`'s remaining
   money update live in both contexts, and that the lot resolves to the same winner and price
   in both.
4. Simulate a dropped connection (block the SSE request, or toggle offline) in one context,
   let the underlying pick continue elsewhere, restore the connection, and assert the dropped
   context's `ConnectionBanner` shows "Reconnecting…" then goes visually quiet again once live,
   and the view catches up via the gap-triggered `refresh()` rather than silently missing the
   pick.
5. Open `/draft/dev_draft_snake/board` and assert it mirrors the same picks as the room, with
   no interactive controls rendered anywhere on the page.

## Known follow-ups

- **The browser e2e above.** Scoped and deferred; see the section immediately above.
- **A transient full-suite DB hook timeout has been observed twice under load** (during the
  Task 3 and Task 7 verification runs of this plan), root cause suspected to be test-database
  connection-pool contention across the ~40 test files that each open their own pool via
  `createTestDb()` (`src/db/test-db.ts`). `createTestDb()` already uses a small pool
  (`DB_POOL_CONFIG.testMaxConnections`) with a short idle timeout and registers its own
  `afterAll` to close the pool, which is the existing mitigation. Vitest's `fileParallelism:
  false` (`vitest.config.mts`) already serializes test FILES against each other — tests
  *within* a file are already sequential by default, so this setting is what stops multiple
  files' pools from ever being open at once, not the other way around. After a third
  occurrence under CPU pressure, `vitest.config.mts` now sets `testTimeout: 15_000` and
  `hookTimeout: 30_000` globally (ceilings, not targets — a healthy run is unaffected).
