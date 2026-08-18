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
   The state route returns the `DraftStateView`, the caller's own `teamId`, whether they are
   the commissioner, and the league's team cards. The players route returns ranked player
   metadata, and is separate precisely because the state route is refetched often and the
   player dictionary never changes during a draft — `refresh()` (see step 4) fetches it
   **once per `draftId`**, not on every resync, and refetches only when `draftId` itself
   changes.
2. **Subscribe** → a native `EventSource` on `/api/leagues/<leagueId>/events`, opened only
   once the mount fetch has resolved a `leagueId`. **The browser owns reconnect and
   `Last-Event-ID`.** There is no retry loop, no backoff timer and no polling anywhere in this
   codebase; adding one would be a bug, not a feature. **Every `open` resyncs the state view
   — the first one included, not only a reconnect's.** The stream only carries events
   published after it opens, and it opens after the mount snapshot has already resolved, so a
   pick or bid published in that window would otherwise sit unseen until the next event
   arrives; the first `open`'s resync closes that gap. A reconnect's `open` covers the
   analogous gap beyond stream retention. Because players are cached per `draftId` (step 4),
   every one of these resyncs is a single extra state fetch, never a full re-fetch pair.

   The stream carries **named SSE events**, not one generic `message` frame: `useDraftRoom`
   registers one listener per draft event type (`draft.pick`, `draft.nominate`, `draft.bid`,
   `draft.timer_expire`, `draft.status`) via `source.addEventListener(type, handler)`, plus
   separate `open` and `error` listeners for connection state. `chat.*` and `score.update`
   frames ride the same stream under their own event names and are never listened for here —
   the draft room is not their consumer.
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
`deadlineAt`, clamped to zero, ticking on `DRAFT_ROOM_CONFIG.countdownTickMs`" — both
`ClockBanner` and `AuctionLotPanel` use it rather than each carrying its own `useNow` +
`Date.parse` arithmetic.

## Components inventory (`src/draft-room/components/`)

| Component | Renders |
|---|---|
| `DraftRoom` | The client entry point for `/app/drafts/[draftId]`. Owns the loading/error/ready split and is the one place a rejected `submit()` becomes a toast. Picks `SnakeRoom` or `AuctionRoom` by `view.format`. |
| `SnakeRoom` | Clock, pick-celebration, `PlayerPool` (action: "Draft"), `RosterBoard`, `PickHistory`. |
| `AuctionRoom` | Clock, pick-celebration, `AuctionLotPanel`, `BidControls`, `PlayerPool` (action: "Nominate"), `BudgetTable`, `RosterBoard`, `PickHistory`, `NominateModal`. |
| `TvBoard` | The read-only `/draft/[draftId]/board` shell: clock, pick-celebration, an "on the clock" spotlight, and `PickHistory` in `variant="tv"`. Shares `useDraftRoom` with the real room — no second data path. Renders no control except the error state's retry. |
| `ClockBanner` | Whose turn it is, the countdown, the clock-length sentence, and `formatTightening`'s "picks shorten to …" line. Branches on `view.phase` (`scheduled` / `complete` / `in_progress`). |
| `Countdown` / `useCountdown` | The one shared countdown implementation (see "Wall clock" above). `Countdown` itself is `aria-hidden`. |
| `PlayerPool` | Server-ranked player list with name search and a position `Select`; caps rendered rows at `DRAFT_ROOM_CONFIG.poolPageSize`. Never re-ranks. |
| `RosterBoard` | Expands each team's declared roster shape (`view.slotConfig`) into one cell per spot, filled or not, from `view.rosters`. |
| `PickHistory` | A `Table` of `view.picks`, newest first. `variant="room"` (default) shows slot and auto-pick badge; `variant="tv"` drops those and widens for a TV audience. |
| `AuctionLotPanel` | The lot everyone is watching: nominated player, standing high bid and bidder, and the bid-window countdown (from `view.deadlineAt`, via `useCountdown`). |
| `BidControls` | The bid form. `view.minBid` is the floor and `view.maxBids[myTeamId]` is the ceiling — both server-computed, never re-derived. |
| `NominateModal` | Confirms a nomination (it commits money) before submitting `{ type: "NOMINATE", playerId, openingBid }`. |
| `BudgetTable` | Remaining budget and ceiling per team, read straight off `view.budgets` / `view.maxBids`; own-row highlighted. |
| `PickCelebration` | The pick-landing panel, `role="status"`, keyed on `pickNumber` so a redelivered pick never re-animates. Distinct treatment for the acting user's own pick (`animate-pick-mine` vs `animate-pick-landed`); no animation class at all when `usePrefersReducedMotion()` is true. |
| `ConnectionBanner` | Renders nothing when `connection === "live"`; a small `aria-live="polite"` badge for `"connecting"` / `"reconnecting"`. Information, not a control — the browser reconnects on its own. |

`src/draft-room/lib/lookups.ts` — `teamsById` / `playerName` / `teamName`: the one place a
`teamId`/`playerId` is turned into the human it names, built once per render and shared by
every component above that needs it, instead of each component re-declaring its own
`.find(...)`.

## Accessibility notes specific to this room

- Countdowns are `aria-hidden`. A number changing every second inside a live region is
  unusable with a screen reader; each countdown is paired with a static sentence that says the
  same thing.
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
   draft). Make a pick as one; assert the other's `RosterBoard`, `PlayerPool` and
   `PickHistory` all update without a reload.
3. Repeat against `dev_draft_auction`: run a bid war between the two contexts — nominate,
   alternate bids, assert `AuctionLotPanel`'s high bid/bidder and `BudgetTable`'s remaining
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
