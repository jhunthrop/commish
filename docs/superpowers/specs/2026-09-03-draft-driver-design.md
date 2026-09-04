# Draft drivers for serverless — design and plan (2026-09-03)

## The incident

Mock drafts stall forever on trycommish.app. `src/instrumentation.ts` starts
`getDraftTicker()` (and the stats ingestion worker) "once per server process" — on Vercel each
function invocation is short-lived, so the ticker that retries deferred solo starts
(`[mock-draft] solo start deferred to the ticker`), fires bot picks and applies clock expiries
effectively never runs. A solo mock whose self-start failed waits for a due scan that no process
hosts; even a started draft freezes the moment no invocation happens to be alive and ticking.

## The design: three cooperating drivers, one advancement funnel

All three drivers funnel into the SAME store paths the ticker uses today. Nothing new touches
`src/draft-engine`; every action still enters through `store.applyAction` /
`store.startDraft` / `startMockDraft`, under the same `drafts FOR UPDATE` row lock, the same
`admitCommand` guards, and the same `(draft_id, sequence)` unique-index backstop.

### The advance routine (`src/draft-service/advance.ts`)

`createDraftAdvancer({ db, store, mockDriver, nudger?, newId? })` exposes
`advance(draftId, now)`: apply ALL due work for ONE draft, bounded by
`DRAFT_ADVANCE_CONFIG.maxActionsPerAdvance`.

Per call:

1. **Deferred start.** A `scheduled` draft first gets its due start applied:
   - a mock room whose `mock_rooms.starts_at` has passed goes through `startMockDraft`
     (`@/mock-draft-service/start`) — the ONE callable every mock start path shares; a mapped
     409 is the benign lost race, absorbed exactly the way the ticker's due scan absorbs it;
   - a real draft goes through `dueDraftsQuery` narrowed to this one draft id (same builder,
     same predicates — public matchmade, enforcement switch, seats full, kickoff passed) and
     then `store.startDraft(draftId, { auto: true })` — the identical seam
     `autoStartDueDrafts` uses. A private league's draft is never touched; a short public room
     is never started (the query's own seat predicate). Rolls stay with the sweep job's
     `autoStartDueDrafts` call — a read must not move a kickoff.
2. **Catch-up loop.** While `in_progress` and under the action bound, compute the next due
   action and apply it AT its due instant (see timestamp semantics below):
   - a mock draft with a bot on a running clock: the bot's pick, due at
     `turnStartedAt + botThinkDelaySeconds(...)` (zero delay for a sim-to-next-pick room) —
     computed by the driver's own `dueBotPick` (below), applied as the same plain `MAKE_PICK`
     the live driver submits;
   - otherwise: `TIMER_EXPIRE` due at `currentDeadline(state)` — the engine's own selector,
     the identical action shape the ticker submits.
   When neither is due, the moderator gets its window (`nudger.nudge(state, now)`, same
   placement the ticker's `tickOne` gives it) and the loop ends.
3. **Settle.** A mock that reaches `phase === "complete"` settles its `drafts.status` through
   `settleMockDraftCompletion` — the driver's existing guarded write.

A refusal mid-loop (`ok: false`) means a concurrent advancer got there first: the loop reloads
fresh state and continues; two consecutive refusals end the call (never a spin). The routine
never throws — every failure is caught, logged, and reported in the outcome, the ticker's own
"one draft's failure must not stop the scan" discipline.

### Timestamp semantics: chained due instants (decided)

The live ticker stamps `TIMER_EXPIRE` with the tick's `now` — at a 1s tick that lags the true
deadline by under a second, and every downstream deadline chains from the RECORDED timestamp
(`reduceDraft` sets `turnStartedAt: action.timestamp`; `currentDeadline` and `clockTierFor`
read only `turnStartedAt`). Catch-up stamping "now" for a pick that was due 40s ago would be
wrong twice over: it would push every later deadline 40s late, and it would let
`clockTierFor(turnStartedAt, kickoffAt, schedule)` pick the WRONG TIER for turns that actually
ran (by the schedule) in a faster tier.

So catch-up stamps each action at its COMPUTED DUE INSTANT:

- a `TIMER_EXPIRE` at exactly `currentDeadline(state)` — `admitTimerExpire`'s guard is a strict
  `<`, so the exact deadline is admitted;
- a bot `MAKE_PICK` at `turnStartedAt + delay` (the seeded per-pick draw, so deterministic);
- each applied action's timestamp becomes the next turn's `turnStartedAt`, so a draft abandoned
  for 10 minutes with 60s clocks catches up ~10 actions whose timestamps march in clock-sized
  steps — never all stamped at read time.

This makes catch-up byte-identical to the IDEALIZED due schedule — a zero-latency live ticker —
and, because the bot RNG is seeded per pick and cursored off the log (`pickStreamFor`), two
catch-ups (or a catch-up racing a live ticker) can only ever compute the same actions. The real
live ticker's stamps lag each due instant by under one tick; that jitter is the one divergence,
it is bounded, and it is consistent in either direction because every consumer derives deadlines
from recorded timestamps only. Proof tests: the chaining test (timestamps march in clock steps),
and the determinism test (advance called once at T+10min produces the identical log to advance
called repeatedly at 1s steps over the same window).

### Driver 1 — advance-on-read (the backbone)

`GET /api/drafts/[draftId]` and `GET /api/drafts/[draftId]/players` call
`getDraftAdvancer().advance(draftId, now)` before reading state (after auth — only an
authenticated league member can trigger work). A room someone reopens fast-forwards to the true
present in one request. The advance never throws, so a broken advance still serves the read.

Concurrency: two simultaneous readers both advancing serialize through the store's existing
guards — the per-process keyed mutex, the cross-instance `drafts FOR UPDATE` row lock, the
in-lock `load` against `MAX(sequence)`, `admitCommand`'s deadline re-check, and the
`(draft_id, sequence)` unique index as backstop. A losing racer's duplicate action is refused
harmlessly ("The clock hasn't run out yet." / "It's not your turn to pick.") and the loser
reloads fresh state. Test: two concurrent `advance` calls on the same abandoned draft produce
ONE consistent log with strictly-once sequences.

### Driver 2 — the SSE stream ticks while watched

The draft room's realtime wire is the league stream, `GET /api/leagues/[leagueId]/events`
(`createLeagueEventStream`). That route now:

- declares `maxDuration = 300` (the precedent set by `/api/jobs/tick`; runtime was already
  `nodejs`) so a watched room holds its invocation as long as the plan allows;
- on connect, resolves the league's draft and — if it is `scheduled` or `in_progress` — starts
  `runDraftAdvanceLoop({ advance, draftId, signal, intervalMs })`: an overlap-guarded
  `setInterval` at `DRAFT_ADVANCE_CONFIG.sseIntervalMs` (1s) that calls the same advance
  routine, exits cleanly on the request's abort signal, and stops itself once the draft
  completes. No transaction is held across ticks — each advance action is its own short
  transaction inside the store.

While anyone is watching, bot picks and clock expiries move in real time and every applied
action broadcasts over the same Redis stream the watchers are already subscribed to. Multiple
watchers run multiple loops; the store guards make that harmless (same racer analysis as
driver 1), and each idle loop iteration costs one `MAX(sequence)` freshness check.

### Driver 3 — the jobs backstop

A new job def `src/jobs/defs/draft-sweep-job.ts` (name `draft-sweep`), on the shape of
`season-week-job.ts` but with ONE bounded step (checkpointed steps buy nothing for a
level-triggered sweep that reruns every minute):

- `sweep`: `autoStartDueDrafts` (real due starts AND kickoff rolls), `startDueMockRooms`
  (due mock rooms), then `liveDraftsQuery` (bounded at `maxDraftsPerTick`, same as the ticker)
  and one `advance` per live draft, under a sweep-wide action budget
  (`DRAFT_ADVANCE_CONFIG.sweepMaxActions`) so one sweep can never outgrow the runner's tick
  budget — work left over is found by the next minute's fire (level-triggered: `drafts.status`
  never lies, unfinished work is always findable).
- Terminal-vs-retryable per the jobs contract: nothing in the sweep is a refusal worth
  dead-lettering — the advance routine absorbs per-draft failures — so any thrown error is
  transient weather; `maxAttempts: 2` with a short backoff (a third attempt would just race the
  next minute's own fire). `timeoutMs` sits under the Vercel tick's 50s budget.
- Scheduled `* * * * *` in `schedules.ts`. Schedules gain an optional per-schedule
  `catchUpMs` (default `JOBS_CONFIG.maxCatchUpMs`): a minute-cadence, level-triggered sweep
  must not replay a laptop-asleep week as 10,080 queued no-ops, so `draft-sweep` keeps a
  5-minute window — one caught-up run does the work of every missed one.

So an abandoned room — nobody watching, tab closed mid-draft — still completes on minute
granularity instead of freezing.

### Driver 0 — dev keeps the ticker (and prod turns it off)

`instrumentation.ts` still starts the in-process ticker and the stats ingestion worker for
local/self-hosted runs — the ticker is why drafts feel instant locally. Both starts are now
gated to non-Vercel (`process.env.VERCEL` unset, the platform's own marker): on Vercel the
three drivers replace the ticker entirely, and a ticker inside whichever invocation happened to
run `register()` would only burn that invocation's duration doing work the drivers already do.
DECIDED: gate OFF in production rather than letting it coexist — coexistence is SAFE (the ticker
serializes through the same store; the concurrent-advancer test is exactly that proof) but
pointless, and the gate makes the production topology legible: reads, streams and the minute
cron are the only drafts-advancing agents on Vercel.

The stats ingestion worker has the same serverless death, but its correct production path is the
existing season-week/jobs system — no new driver here. Its in-process start is env-gated off on
Vercel alongside the ticker; live-Sunday ingestion cadence on Vercel is a KNOWN FOLLOW-UP ticket
for the jobs system (see the comment in `instrumentation.ts` pointing at
`src/jobs/defs/season-week-job.ts`).

## What is deliberately NOT changed

- `src/draft-engine` — untouched. Drivers submit through existing store/service entry points.
- The ticker's own live semantics (`timestamp: now`, one paced bot pick per draft per tick,
  the house reconcile, the retention sweep, the nudge lane) — its tests still pin them.
- `dueDraftsQuery`'s measured EXPLAIN shape — the draftId narrowing is additive and optional;
  the unfiltered call is byte-identical.
- The mock bot driver's live pacing — `dueBotPick` is extracted so the paced lane, the sim lane
  and catch-up all read ONE delay-and-choice computation; behavior of `driveBotPick` is
  unchanged and its tests prove it.

## Plan (TDD; draft-service work test-first)

1. Spec + plan (this file) — commit.
2. `mock-draft-service/driver.ts`: extract `dueBotPick(state)` onto `MockBotDriver`; refactor
   `driveBotPick`/`simToHumanTurn` onto it. Tests: due instant arithmetic (paced + sim), and the
   existing driver suite stays green.
3. `draft-service/advance.ts` + `DRAFT_ADVANCE_CONFIG`: the advance routine. Tests (new
   `advance.test.ts`): deferred mock start retry; deferred real auto-start (and the private /
   short-room refusals); catch-up chaining (10 abandoned minutes, 60s clocks → ~10 actions in
   clock-sized steps); catch-up determinism (one call vs stepped calls, identical logs); bot
   catch-up (solo mock abandoned mid-draft completes with seeded picks); concurrent advancers
   (one consistent log); the action bound; never-throws.
4. `runDraftAdvanceLoop`: fake-timer tests — ticks at the interval, no overlap, stops on abort,
   stops on completion.
5. Routes: advance-on-read in the two GETs; the SSE route's loop + `maxDuration`.
6. Jobs: per-schedule `catchUpMs` (schedule.test.ts), `draft-sweep-job` def + registry +
   schedule (def test drives a due mock and an expired clock through one sweep; registry test
   already pins schedule/job wiring).
7. `instrumentation.ts` gating + comment; keep the single `if` block bundler shape.
8. Gates: `tsc` 0, eslint clean, draft-service + draft-engine + jobs suites green, full-suite
   sanity for touched routes.
