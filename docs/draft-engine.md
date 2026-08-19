# Commish — Draft Engine & Draft Service

Read this with `docs/conventions.md` before touching anything under `src/draft-engine/` or
`src/draft-service/`. The engine is pure; the service is the only part that talks to Postgres
or Redis. One system runs both snake and auction drafts natively — that is the wedge (strategy
doc §1.1: our closest competitor hands its auctions to ESPN).

## The two layers

| Layer | Path | Rule |
|---|---|---|
| Engine | `src/draft-engine/` | Pure. No I/O, no `Date.now()`, `readonly` everywhere, 100% test coverage enforced. |
| Service | `src/draft-service/` | Owns persistence, publishing, locking, the ticker, and authorization lookups. |

## The action union (persisted forever)

`draft_actions.action` stores a `DraftAction` (see `src/domain/draft.ts`) as jsonb. Every
member carries `v: 1` (`DRAFT_ACTION_VERSION`). A future shape change adds `v: 2` members plus
an explicit upgrade path in `draftActionSchema` — it never reinterprets an old row.

- `START_DRAFT` — carries `draftOrder` **and** the ranked `pool`. Snapshotting both is what
  makes replay deterministic: nothing about a past draft depends on today's rankings.
- `MAKE_PICK` — `{ teamId, playerId }` (snake).
- `NOMINATE` — `{ teamId, playerId, openingBid }` (auction; a nomination is a bid).
- `BID` — `{ teamId, amount }` (auction).
- `SET_QUEUE` — `{ teamId, playerIds }`, replacing a team's ranked autopick queue wholesale.
  In the log rather than a side table, on purpose: `state.queues[teamId]` (`queueFor`) is
  derived by replay exactly like `rosters` or `budgets`, so a queue edit is exactly as
  replay-safe and durable as a pick. See `docs/draft-moderator.md`. Capped at
  `DRAFT_QUEUE_CONFIG.maxLength` client-side; `PERSISTED_QUEUE_MAX` is the separate, frozen
  ceiling for the jsonb row itself and must never decrease.
- `TIMER_EXPIRE` — no payload. **Server-only**: produced by the ticker, never accepted over HTTP
  (the actions route's Zod schema has no `TIMER_EXPIRE` member a client can submit).

## State shape

`DraftState` = static `config` (from the `drafts` + `leagues` rows) + `phase` + `sequence` +
`draftOrder` + `pool` + `picks` + `rosters` (filled slots only) + `budgets` + `auction` +
`pickNumber` + `turnStartedAt`. Deadlines are **derived** from `turnStartedAt` and
`config.clockSchedule`, never stored — which means a deadline is only ever meaningful *now*,
against the schedule in force at this deploy. That is exactly why the deadline check is a
command-time admission guard (`admit.ts`) and not a reducer guard: see the R-B4 section below.

## The reducer result shape

Every reducer function — `reduceDraft` and everything it dispatches to — returns the one
`DraftReduceResult` (`src/draft-engine/state.ts`, kept there rather than in `reduce.ts` so
`snake.ts`/`auction.ts` can reference it without an import cycle):

```ts
type DraftReduceResult =
  | { ok: true; state: DraftState }
  | { ok: false; reason: string };
```

`reduceDraft(state, action)` is total and pure: it either returns a new state with
`sequence` exactly one higher than the input, or a plain-language `reason` safe to show a
user (the API returns it verbatim as a 409). Nothing under `src/draft-engine/` reads a wall
clock — every timed decision consumes a timestamp the caller supplied.

## Invariants

1. The reducer is total and pure, as above.
2. Roster legality is never restated: `assignSlot` delegates to
   `src/domain/roster-eligibility.ts`'s `validateRosterAdd`.
3. A player can be drafted once. Turn order is enforced for snake picks and auction nominations.
4. **Auction budget-reserve rule**: a team keeps `AUCTION_CONFIG.reservePerOpenSlot` ($1) in
   reserve for every roster spot it still has to fill *after* the one it's bidding on
   (`maxBidFor` = `remainingBudget − (openSlots − 1) × reservePerOpenSlot`), so a team with an
   open spot can always afford the minimum bid — that is why auto-nomination can't deadlock. A
   draft can't start unless the budget covers at least `minBid` per roster spot
   (`reduceStart` in `reduce.ts`).
5. **Autopick and auto-nomination are queue-first.** `bestAvailableFor` (`selectors.ts`) is the
   one policy both `reduceSnakeExpiry` and `reduceAuctionExpiry` call: it takes the first entry
   in the team's own ranked queue (`queueFor`) that is still available and still legally
   rosterable; only once the queue is empty or exhausted does it fall back to the
   highest-ranked player by `state.pool`'s order. Both the queue and the pool are explicit
   inputs carried in the action log, never an ambient lookup, so the same log always autopicks
   the same player on replay.
6. The pick clock auto-tightens against kickoff: `DRAFT_CLOCK_SCHEDULE` = 8h → 4h → 1h → 10m →
   1:30. A tier applies while the draft is more than `untilHoursBeforeKickoff` hours out; the
   last tier is the floor. Live auction bidding uses the shorter of the tier and
   `AUCTION_CONFIG.bidWindowSeconds` (`currentClockSeconds`).

## Auto-tightening clock semantics

`currentTier(state)` picks the schedule entry in force for the turn currently running, by
comparing `turnStartedAt` against `config.kickoffAt` (`clockTierFor`). `currentDeadline(state)`
derives the actual instant the clock expires: `turnStartedAt + currentClockSeconds(state)`,
where `currentClockSeconds` is the tier's `pickSeconds`, clamped to
`AUCTION_CONFIG.bidWindowSeconds` whenever an auction lot is open. Because the deadline is
computed from `turnStartedAt` and the config on every read, it is never itself persisted, and a
tier boundary crossed mid-turn does not retroactively shorten a turn already in progress —
`clockTierFor` is evaluated once, against the instant the turn *started*.

`nextTightening(state)` (`nextTighteningAfter`) reports when the schedule's tier next changes
and to what, so the UI can show "clock tightens to 10m in 3h12m" ahead of time — it is derived
the same way, from `turnStartedAt` forward, and is `null` before/after the draft or once the
final tier is already in force.

## The lookahead: `upcomingOnClock`

`upcomingOnClock(state, count)` names the next `count` teams due to act, **current turn
first**. It exists so a browser can answer "when am I up?" with an index lookup instead of
re-implementing serpentine order — the one rule `docs/draft-room.md` forbids in React.

It grows no third walk of its own:

- **Snake** replays `snakeTeamForPick` forward from `state.pickNumber`, stopping at
  `totalPickCount(state)` — the same ceiling `advanceSnake` completes the draft at, which is
  why that ceiling now lives in `state.ts` and is called from both places. A snake draft never
  skips a team: every team owns the same number of roster spots, so they all fill their last
  one on the last round.
- **Auction** chains `nextNominator` (which already skips full rosters) and cycles once the
  rotation comes back around — an auction's order repeats, so a 12-deep lookahead in an 8-team
  league legitimately names some teams twice. `nextNominator` moved from `auction.ts` to
  `selectors.ts` for this: one rotation, imported by both the reducer and the lookahead.
- **While a lot is open** there is no team on the clock (`teamOnClock` is null by design), so
  the walk starts with the team due to nominate *after* the one whose lot is live. It reads
  the rosters as they stand, so if the lot's winner fills their last spot the list shifts by
  one — the next event's clock carries the corrected list, which is exactly why `upcoming`
  rides every payload rather than being fetched.
- **Outside `in_progress`** it is empty.

`DraftClockView` carries `upcoming`, sized by `DRAFT_VIEW_CONFIG.upcomingCount` (12) in
`config.ts`. Because it lives on the clock view, it rides `draftStateView` **and** every
`draft.*` payload, so it can never be stale by more than the event that would refresh it.

## Auto-nominate on stall

In an auction, `teamOnClock` returns the nominating team only while no lot is open — during
live bidding the clock belongs to everyone and nobody is "on the clock" to nominate. If a
nominating team's clock runs out before they nominate, `reduceAuctionExpiry` (with
`auction.lot === null`) auto-nominates their best available player at the minimum bid
(`autoNominated: true` on the resulting lot), exactly the same policy `bestAvailableFor` uses
for a stalled snake pick. This is what keeps an idle nominator from stalling the whole auction.

## The deadline guard on TIMER_EXPIRE (Ruling R-B4)

`admitCommand` (`src/draft-engine/admit.ts`) rejects the action outright — `"The clock hasn't
run out yet."` — whenever `action.timestamp` is earlier than `currentDeadline(state)` computed
against the state the action is being applied to (not the state the caller read earlier):

```ts
const deadline = currentDeadline(state);
if (deadline !== null && Date.parse(action.timestamp) < Date.parse(deadline)) {
  return { ok: false, reason: "The clock hasn't run out yet." };
}
```

This closes a check-then-act race: the ticker reads state and computes a deadline in one step,
then submits `TIMER_EXPIRE` in a later, separate step. A legitimate human action (a pick, a
nomination, a bid) can land in the gap and start a fresh clock for someone else — the ticker's
now-stale timestamp must not be allowed to expire *that* new clock. Because the guard is
evaluated against the store's current, freshly-loaded state inside `applyAction`'s mutex
(not the ticker's cached read), the race is provably harmless: at worst the ticker's
`TIMER_EXPIRE` is rejected and the next tick retries against the real deadline. No stale expiry
can ever autopick or auto-award on behalf of the wrong turn.

## Command-time admission vs. reducer guards

**The invariant: a reducer guard may only read the action log and prior state — never a
module-level tunable — because tunables change with deploys and logs do not.**

`replayDraft` calls `reduceDraft` on every persisted action, so any guard the reducer owns is
re-adjudicated every time a draft is loaded. A guard that reads a tunable therefore re-judges
history against today's constants, and a single tuning change can turn a valid log into a
`DraftReplayError` — a permanent 500 on `GET /api/drafts/:id`. This is not hypothetical: raising
the clock schedule's floor from 60s to 90s did exactly that to a live draft.

`admitCommand(state, action)` in `src/draft-engine/admit.ts` owns every such guard. It runs once,
at command time, inside `applyAction`'s mutex against freshly-loaded state, and **is never called
on the replay path**. The guards that live there:

| Guard | Tunable it reads |
|---|---|
| `TIMER_EXPIRE` deadline | `config.clockSchedule`, and `AUCTION_CONFIG.bidWindowSeconds` via `currentClockSeconds` |
| `SET_QUEUE` length cap | `DRAFT_QUEUE_CONFIG.maxLength` |
| `NOMINATE` opening-bid floor | `AUCTION_CONFIG.minBid` |
| `BID` increment | `AUCTION_CONFIG.bidIncrement` |
| `NOMINATE`/`BID` budget ceiling | `AUCTION_CONFIG.reservePerOpenSlot` via `maxBidFor` |
| `START_DRAFT` budget-per-slot floor | `AUCTION_CONFIG.minBid` |

Everything else — turn order, phase, duplicate player, "not in this draft", roster shape, "there
is no budget at all" — is a pure function of the log and prior state and stays in the reducer.

Two consequences worth stating. First, the `SET_QUEUE` length message is now permanently
unreachable through the reducer, which is correct: `PERSISTED_QUEUE_MAX` exists precisely so a
persisted queue longer than today's cap still replays. Second, `config.slotConfig` and
`config.auctionBudget` are still read *while folding state* (`apply-pick.ts`, `state.ts`,
`reduce.ts`); they are per-league DB columns with no update path today, but the moment a
commissioner-settings screen exists, editing the roster shape would silently rewrite draft
history. Snapshot them into the `START_DRAFT` payload when that phase lands.

## The replay model

The `draft_actions` log is the source of truth. `replayDraft(config, actions)` rebuilds state
from it, and the store's in-memory map is only a materialization — dropping it costs nothing.
`applyAction` therefore always: **load → validate → persist → cache → publish (best-effort)**.

Two guards stop a double append:

1. **The per-draft mutex** (`createKeyedMutex`): an in-process, per-key promise chain that
   serializes `getDraftState`/`applyAction`/`commitDraftResults` calls for the same draft id.
   It is *not reentrant* — no method may call another store method while already holding it.
   Single-process only: it stays in place as an intra-process fast path even once more than one
   instance runs (below), but the write path's cross-instance safety comes from a
   `SELECT ... FOR UPDATE` transaction lock on the draft's own row, not this mutex and
   deliberately not a Postgres advisory lock — see `mutex.ts`'s docblock for why
   (`pg_advisory_lock` is session-scoped, and this app reaches Postgres through PgBouncer in
   transaction pooling mode, where a session isn't a stable thing to hold anything on).
   `src/draft-service/locking.test.ts` is the two-instance proof: two independent app instances,
   each its own connection pool and its own in-process mutex, submit simultaneous conflicting
   actions against the same draft, and the test asserts exactly one is accepted and the log for
   that draft is left fully consistent.
2. **The unique index on `(draft_id, sequence)`** (`draft_actions_draft_sequence_idx`) is the
   real backstop: even if the in-process lock is bypassed (a second instance, a bug), two
   writers racing to insert the same `(draftId, sequence)` collide at the database, and
   `isSequenceConflict` turns that specific unique-violation into a clean `{ ok: false, reason:
   "Someone else acted first. Try again." }` instead of a duplicated pick. A `draft_picks`
   primary-key clash from `commitDraftState` inside the same transaction is also a `23505`, but
   keying on the constraint name (not just the SQLSTATE) keeps that distinct from a sequence
   race, so a real commit bug surfaces as the unexpected error it is rather than a misleading
   retry message.

A bug in the mutex therefore costs a retry, never a duplicated pick.

### Multi-instance considerations (Phase 2 Plan A)

Three things change once more than one process runs this service. Two are already fixed (Tasks
6 and 7); the third is still open, noted here so a later task doesn't have to rediscover it:

- **The per-process cache under multiple instances — fixed (Task 6).** `cache` in `store.ts` is
  scoped to one process, so a second instance's write used to be invisible to the first
  forever: a WRITER on a stale instance self-healed (its `INSERT` lost the unique-index race,
  `isSequenceConflict` fired, the stale entry was dropped, and the caller saw "Someone else
  acted first. Try again."), but a READER on a stale instance had no such signal —
  `getDraftState` would happily serve a frozen board forever, since nothing told it another
  instance had moved the draft forward. Fixed by making the cache validate itself instead of
  trusting itself: `latestActionSequence(db, draftId)` is one indexed
  `MAX(draft_actions.sequence)` query, and a cache hit is only served when it equals the cached
  state's own `sequence`; a mismatch drops the entry and the read replays from the log. One
  extra indexed read on every cache hit, not a full replay, and it protects readers and writers
  alike — a writer's own `load()` goes through the same check before computing what to append.
- **`lock_timeout` — still open.** The `SELECT ... FOR UPDATE` row lock above has landed (Task
  7) and now owns cross-instance write safety; the per-draft mutex is what usually keeps two
  writers in the *same* process from even reaching the database at the same moment. Across
  instances, though, a second writer's `INSERT` can still block for the full duration of the
  first writer's transaction — including `commitDraftState`'s multi-table commit on the
  completing action — because no `lock_timeout` is set on the lock acquisition. A future task
  should add one so a stuck or slow instance fails fast with a retryable error instead of
  hanging every other writer for that draft.
- **N instances means N tickers.** Every instance that calls `getDraftTicker()` runs its own
  `setInterval` scan of `drafts` with `status = 'in_progress'`. This is harmless
  correctness-wise — R-B4 plus the `(draft_id, sequence)` unique index mean at most one
  instance's `TIMER_EXPIRE` ever lands — but it's `N`× the redundant scanning and `N`× the
  rejected-write noise (the ticker's `onOutcome` rate-limits its own logging per draft, but
  doesn't reduce the underlying write attempts). A future phase should elect a single ticker
  some other way; a session-scoped Postgres advisory lock has the same PgBouncer transaction-
  pooling problem here as it does for the write path above, so whatever replaces this needs to
  be transaction-scoped or backed by a row (e.g. a lease row a ticker instance holds and
  periodically renews) rather than a session-scoped lock.

## The auto-commit-on-completion seam

`commitDraftState` (`commit.ts`) is the single seam between "a draft happened" and "a season
exists": in one transaction it writes `draft_picks`, upserts `roster_slots`, flips
`drafts.status` to `complete`, and writes the season's fixtures
(`writeSchedule`, `src/league-service/schedule.ts` → `weeks` + `matchups`). `applyAction`
calls it automatically, inside the very same transaction that inserts the completing action
row, the moment a draft's `phase` transitions to `complete` — so a draft can never be "done"
in the log without also being committed.

The schedule belongs in this transaction rather than in a follow-on call: a league with
drafted rosters and no fixtures has nothing to play, and any later step is a step that can
fail to run. `writeSchedule` is idempotent (`onConflictDoNothing` on both primary keys) and
never throws on an unbuildable schedule — it logs and writes nothing — so neither the
defensive re-commit below nor a one-team league can turn a legitimately complete draft into a
failed commit. `draft-service` → `league-service` is the only direction this edge runs (a
draft produces a season; a season never produces a draft), and `schedule.ts` imports nothing
but `@/db/*`, `@/league` and Drizzle, so there is no cycle.

`commitDraftResults(draftId)` is a defensive/admin seam, not the normal path — `applyAction`
already commits automatically the instant a draft completes (previous paragraph). It exists,
and is idempotent (checks `drafts.status` first; if already `complete` it returns
`{ ok: true, alreadyCommitted: true, ... }` without writing anything again), for the cases
where that automatic commit didn't happen: crash recovery (log completed, process died before
its own transaction ran) or a one-off admin/tooling call. It can never double-insert picks or
roster slots.

## Event payloads (`draft.*`, on the league stream)

`draftEventsFor(prev, next, action)` derives events from the **state diff**, not the action
alone. Every payload carries `draftId` and a `clock` block — exactly the `DraftClockView`
(`phase`, `sequence`, `pickNumber`, `onClockTeamId`, `deadlineAt`, `clockSeconds`,
`nextTightening`, `upcoming`) that `draftStateView` also embeds. That is what lets a browser fold an
event into its view and know the new deadline and tier without re-deriving either; the
sequence number a client uses for gap detection is `payload.clock.sequence`.

| Event | Extra payload | Emitted when |
|---|---|---|
| `draft.status` | `phase` | `next.phase !== prev.phase`. |
| `draft.pick` | every `CompletedPick` field (`pickNumber`, `round`, `teamId`, `playerId`, `slot`, `slotIndex`, `price`, `timestamp`, `auto`); **auction only:** `budgets`, `maxBids` and `minBid` after the award | Once per new entry in `next.picks`. |
| `draft.nominate` | `teamId`, `playerId`, `openingBid`, `auto`, `minBid` (the floor for the NEXT bid on this lot) | A new lot opens. |
| `draft.bid` | `teamId`, `playerId`, `amount`, `minBid` (the floor for the NEXT bid on this lot) | The open lot's high bid changes without a new player. |
| `draft.timer_expire` | `pickNumber` (the pick the clock ran out on) | Every accepted `TIMER_EXPIRE`, always pushed first. |
| `draft.queue` | `teamId` only — **the ordered list itself is never broadcast**, since a queue is a private draft plan. | Every accepted `SET_QUEUE`. Clock-only on the client: sequence advances, nothing else about the view changes. |
| `draft.nudge` | `teamId`, `message` (the moderator's one sentence) | **Not emitted by `draftEventsFor`** — published directly by the nudge scheduler (`createNudgeScheduler`, `src/draft-service/nudge.ts`) on the ticker's own schedule, independent of any action. See `docs/draft-moderator.md`. |

Two fields are easy to misread because a `pickNumber` appears twice with different meanings
on the same payload. On `draft.pick`, the **top-level** `pickNumber` is that pick's own
number (it came off `CompletedPick`), while `clock.pickNumber` is the number of the pick now
coming up NEXT — the pick just made has already been applied by the time the event is built.
On `draft.timer_expire`, the top-level `pickNumber` is the pick the clock ran out on (the
*pre*-transition number), while `clock.pickNumber` again reflects whatever the resulting
autopick or auto-nomination advanced to.

Ordering is deliberate and enforced by `draftEventsFor`'s own push order: `draft.timer_expire`
always precedes the `draft.pick` or `draft.nominate` it caused, and both precede a trailing
`draft.status` when the same action also completes the draft — so a client can render events in
arrival order without reordering.

`draftEventsFor`'s auction block (`draft.nominate`/`draft.bid`) is gated on the lot having
**actually moved** — a new player, or a higher `highBid`/`highBidTeamId` — not merely on a lot
being open. `SET_QUEUE` arriving while a lot is live changes nothing about that lot, so this
gate is what stops a queue edit during a live auction from re-broadcasting the standing bid as
if somebody had just raised it.

## API

| Route | Who | Notes |
|---|---|---|
| `GET /api/drafts/[draftId]` | a manager with a team in the league, or the commissioner | `draftStateView` + the caller's own `teamId` + `isCommissioner` + `teams` (every `TeamCard` in the league). A commissioner with no team of their own (`teamId === null && isCommissioner`) is still allowed to view. |
| `GET /api/drafts/[draftId]/players` | a manager with a team in the league, or the commissioner | Ranked player metadata (id/name/position/nflTeam) for the pool. Separate from the state route because it never changes mid-draft and the state route is refetched on every resync. |
| `POST /api/drafts/[draftId]/actions` | a manager with a team in the league | Body: `{ type: "MAKE_PICK" \| "NOMINATE" \| "BID", … }`. **No `teamId`** — the server resolves it from the session. A rejected action is a 409 with the reducer's reason. |
| `POST /api/drafts/[draftId]/start` | commissioner only | Fixes the order and the ranked pool. |
| `GET /api/drafts/[draftId]/queue` | a manager with a team in the league, or the commissioner | The caller's OWN autopick queue, never anybody else's. A commissioner with no team of their own gets `[]`, not a 403. |
| `POST /api/drafts/[draftId]/queue` | a manager with a team in the league | Body: `{ playerIds: string[] }`. **No `teamId`** — the acting team is resolved from the session, same as `/actions`. A rejected change (a duplicate id) is a 409 with the reducer's reason; a queue over `DRAFT_QUEUE_CONFIG.maxLength` is capped by the HTTP schema first and returns 400. |
| `GET /api/leagues/[leagueId]/events` | a manager with a team in the league, or the commissioner | The real-time fan-out: Redis Streams over SSE. Gated the same way as the draft board — a signed-in stranger with no team in the league gets 403, not another league's events. |

There is no second transport and no per-draft stream — `draft.*` events ride the league stream
above.
