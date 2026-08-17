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
- `TIMER_EXPIRE` — no payload. **Server-only**: produced by the ticker, never accepted over HTTP
  (the actions route's Zod schema has no `TIMER_EXPIRE` member a client can submit).

## State shape

`DraftState` = static `config` (from the `drafts` + `leagues` rows) + `phase` + `sequence` +
`draftOrder` + `pool` + `picks` + `rosters` (filled slots only) + `budgets` + `auction` +
`pickNumber` + `turnStartedAt`. Deadlines are **derived** from `turnStartedAt`, never stored,
so no replay can resurrect a stale deadline.

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
5. Autopick and auto-nomination (`bestAvailableFor`) take the highest-ranked player the team
   can legally roster, ranked by `state.pool`'s order — an input, never an ambient lookup.
6. The pick clock auto-tightens against kickoff: `DRAFT_CLOCK_SCHEDULE` = 8h → 4h → 1h → 10m →
   60s. A tier applies while the draft is more than `untilHoursBeforeKickoff` hours out; the
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

## Auto-nominate on stall

In an auction, `teamOnClock` returns the nominating team only while no lot is open — during
live bidding the clock belongs to everyone and nobody is "on the clock" to nominate. If a
nominating team's clock runs out before they nominate, `reduceAuctionExpiry` (with
`auction.lot === null`) auto-nominates their best available player at the minimum bid
(`autoNominated: true` on the resulting lot), exactly the same policy `bestAvailableFor` uses
for a stalled snake pick. This is what keeps an idle nominator from stalling the whole auction.

## The deadline guard on TIMER_EXPIRE (Ruling R-B4)

`reduce.ts`'s `TIMER_EXPIRE` arm rejects the action outright — `"The clock hasn't run out
yet."` — whenever `action.timestamp` is earlier than `currentDeadline(state)` computed against
the state the action is being applied to (not the state the caller read earlier):

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
re-evaluated against the store's current, freshly-loaded state inside `applyAction`'s mutex
(not the ticker's cached read), the race is provably harmless: at worst the ticker's
`TIMER_EXPIRE` is rejected and the next tick retries against the real deadline. No stale expiry
can ever autopick or auto-award on behalf of the wrong turn.

## The replay model

The `draft_actions` log is the source of truth. `replayDraft(config, actions)` rebuilds state
from it, and the store's in-memory map is only a materialization — dropping it costs nothing.
`applyAction` therefore always: **load → validate → persist → cache → publish (best-effort)**.

Two guards stop a double append:

1. **The per-draft mutex** (`createKeyedMutex`, Phase 1 only): an in-process, per-key promise
   chain that serializes `getDraftState`/`applyAction`/`commitDraftResults` calls for the same
   draft id. It is *not reentrant* — no method may call another store method while already
   holding it. Phase 2 (multi-instance) replaces this with a Postgres advisory lock.
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

### Multi-instance considerations (Phase 2)

Three things change once more than one process runs this service, none of which are handled
yet — noted here so Phase 2 doesn't have to rediscover them:

- **`lock_timeout`.** Today the per-draft mutex above is usually what keeps two writers from
  even reaching the database at the same moment. Once a Postgres advisory lock replaces it (see
  above), a second writer's `INSERT` can block for the full duration of the first writer's
  transaction — including `commitDraftState`'s multi-table commit on the completing action.
  Phase 2 should set a `lock_timeout` on that acquisition so a stuck or slow instance fails fast
  with a retryable error instead of hanging every other writer for that draft.
- **The per-process cache under multiple instances.** `cache` in `store.ts` is scoped to one
  process. A WRITER on a stale instance self-heals: its `INSERT` loses the unique-index race,
  `isSequenceConflict` fires, the stale cache entry is dropped, and the caller sees "Someone
  else acted first. Try again." A READER on a stale instance has no such signal —
  `getDraftState` happily serves a frozen board forever, since nothing tells it another
  instance moved the draft forward. Recommended fix: have every instance subscribe to the
  league streams of drafts it has cached and call `invalidate(draftId)` on any `draft.*` event,
  rather than trusting the cache until the next write it personally makes.
- **N instances means N tickers.** Every instance that calls `getDraftTicker()` runs its own
  `setInterval` scan of `drafts` with `status = 'in_progress'`. This is harmless
  correctness-wise — R-B4 plus the `(draft_id, sequence)` unique index mean at most one
  instance's `TIMER_EXPIRE` ever lands — but it's `N`× the redundant scanning and `N`× the
  rejected-write noise (the ticker's `onOutcome` rate-limits its own logging per draft, but
  doesn't reduce the underlying write attempts). Phase 2 should elect a single ticker via a
  Postgres advisory lock (one instance holds it for the ticker role and actually ticks; the
  rest skip their interval) rather than accept the redundancy indefinitely.

## The auto-commit-on-completion seam

`commitDraftState` (`commit.ts`) is the single seam between "a draft happened" and "a season
exists": in one transaction it writes `draft_picks`, upserts `roster_slots`, and flips
`drafts.status` to `complete`. `applyAction` calls it automatically, inside the very same
transaction that inserts the completing action row, the moment a draft's `phase` transitions
to `complete` — so a draft can never be "done" in the log without also being committed.

`commitDraftResults(draftId)` is a defensive/admin seam, not the normal path — `applyAction`
already commits automatically the instant a draft completes (previous paragraph). It exists,
and is idempotent (checks `drafts.status` first; if already `complete` it returns
`{ ok: true, alreadyCommitted: true, ... }` without writing anything again), for the cases
where that automatic commit didn't happen: crash recovery (log completed, process died before
its own transaction ran) or a one-off admin/tooling call. It can never double-insert picks or
roster slots.

## Event payloads (`draft.*`, on the league stream)

`draftEventsFor(prev, next, action)` derives events from the **state diff**, not the action
alone, so a clock-driven autopick or auto-nomination produces the same events a human action
would. All payloads carry `draftId` and `sequence` (the post-transition sequence number).

| Event | Extra payload | Emitted when |
|---|---|---|
| `draft.status` | `phase` (`"in_progress"` \| `"complete"`) | `next.phase !== prev.phase` — i.e. `START_DRAFT` and the action that completes the draft. |
| `draft.pick` | `pickNumber`, `round`, `teamId`, `playerId`, `slot`, `price`, `timestamp`, `auto` | Once per new entry in `next.picks` beyond `prev.picks.length` (a `MAKE_PICK` or a `TIMER_EXPIRE` that awarded/autopicked). |
| `draft.nominate` | `teamId`, `playerId`, `openingBid`, `auto` | A new lot opens (`after.playerId !== before?.playerId`) — a `NOMINATE` or an auction auto-nominate on stall. |
| `draft.bid` | `teamId`, `playerId`, `amount` | The open lot's high bid changes without a new player (`after.playerId === before.playerId`) — a `BID`. |
| `draft.timer_expire` | `pickNumber` (the pick the clock ran out on) | Every accepted `TIMER_EXPIRE`, always pushed first. |

Ordering is deliberate and enforced by `draftEventsFor`'s own push order: `draft.timer_expire`
always precedes the `draft.pick` or `draft.nominate` it caused, and both precede a trailing
`draft.status` when the same action also completes the draft — so a client can render events in
arrival order without reordering.

## API

| Route | Who | Notes |
|---|---|---|
| `GET /api/drafts/[draftId]` | a manager with a team in the league, or the commissioner | `draftStateView` + the caller's own `teamId`. A commissioner with no team of their own (`teamId === null && isCommissioner`) is still allowed to view. |
| `POST /api/drafts/[draftId]/actions` | a manager with a team in the league | Body: `{ type: "MAKE_PICK" \| "NOMINATE" \| "BID", … }`. **No `teamId`** — the server resolves it from the session. A rejected action is a 409 with the reducer's reason. |
| `POST /api/drafts/[draftId]/start` | commissioner only | Fixes the order and the ranked pool. |
| `GET /api/leagues/[leagueId]/events` | a manager with a team in the league, or the commissioner | The real-time fan-out: Redis Streams over SSE. Gated the same way as the draft board — a signed-in stranger with no team in the league gets 403, not another league's events. |

There is no second transport and no per-draft stream — `draft.*` events ride the league stream
above.
