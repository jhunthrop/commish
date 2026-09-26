# Batched bot picks: ledger

Worktree `agent-a495958a488d65e54`, branch `worktree-agent-a495958a488d65e54`, cut from main at
`a8651b1f` (`git merge-base --is-ancestor` confirms). A fix to the live app on a branch from
main, not a rebuild lane: `src` was open to edit. Binding inputs: the Phase 1 findings
(`docs/research/2026-09-18-draft-room-performance-findings.md`), the fix round's ledger and its
production investigation (`docs/research/2026-09-19-draft-room-performance-fix-ledger.md`: Vercel
refuses the fifth self-wake hop with 508, so a room advanced in runs of four and waited for the
minute cron), and the founder's design: the bots are deterministic from the START_DRAFT snapshot
seed, so their picks are a function of state, not events that must occur at a time; only the
reveal is time-shaped.

## The design as built

**Server.** Inside the transaction that lands ANY accepted action on a mock (`DraftStore.
applyAction`: a human's pick, the start, a clock's expiry), the store runs the bot policy
(`MockBotDriver.botTurn`, the same seeded delay and pick streams as before) forward through every
consecutive bot seat until a human is on the clock or the draft is complete, appending each bot's
`MAKE_PICK` to the log in the SAME commit. Each pick is stamped at its own reveal instant: the
previous action's stamp plus that pick's think-delay drawn from `rngFor(botSeed, "<team>:delay:
<pick>")`, `Math.ceil`ed, the identical arithmetic the pick-by-pick drivers stamped by, so an
older log replays byte for byte and `PIN_BOT_DELAYS_MS` still pins the draw. The last bot's
stamp is the human's `turnStartedAt`, so her deadline on the server is the last reveal plus the
clock, never the commit instant. A finished mock settles its status in the same commit. The
room's facts for the post-batch state (the state the next human faces) are computed once on the
same invocation, after its response (`runAfterResponse`, as before), and written to the draft's
own row (`draft_room_facts`, migration 0089: one row per draft, replaced by any newer sequence,
no TTL, no lock); `/assistant` reads memo, then row, then computes. Multi-human lobbies work the
same: the batch runs between any two humans. A committed mock state with a bot on the clock (a
room started before this shipped, or a batch that stopped at a roster that can take nothing)
resolves through `DraftStore.resolveBots` from advance-on-read or the sweep, stamped identically.

**Client.** `useDraftRoom` holds two views: the COMMITTED view (every frame folded on arrival;
the wire's sequence continuity and the advisor's fetch key on it) and the REVEALED view (what
every surface renders), into which the same frames are folded, through the same `applyDraftFrame`,
one at a time at each pick's stamp; a non-pick frame behind a hidden pick reveals with it, never
before it. Before its reveal a pick is invisible, its player still on the board, and the bot on
the clock with the countdown its turn actually runs (the frame's own post-transition clock, which
is the previous stamp plus the clock). Tile, sheet strike, pool leave and stream line all fire off
the revealed fold, so the settle and spring motions are untouched. A viewer who joins or
reconnects mid-batch gets the snapshot; `state/reveal.ts` derives the same reveals from the
picks' stamps (`planReveal`), reveals everything already past its stamp at once and the rest on
schedule. The server's clock is converted by the smallest `Date.now() - published` seen off the
stream's own frame stamps. The advisor (`useAdvisor`) fetches once per committed sequence, at the
first reveal it is waiting on (the pick's own invocation has written the facts by then), and
stages its answer until the room has revealed the state it is about, then shows it: the dock is
ready when the human's turn is, and no odds about a hidden pick show while it is hidden.

**Untouched by design.** Real league drafts (all human seats): `botTurn` answers null for a room
with no `mock_rooms` sidecar, so no batch ever runs; the existing clock, advance-on-read and the
sweep drive them exactly as before. Also untouched: the engine, the reducers, the replay pins.

## Measurement (dev stack, production bundle, `VERCEL=1`, the findings' topology)

Harness (untracked, `.lab/measure/`): `run.sh <label> <distDir> [pacing]` starts `next start -p
3151` under `dotenv -e .env.local -v STATS_PROVIDER=mock -v VERCEL=1 -v DRAFT_PICK_PATH_TIMING=1`
(plus `JOBS_SELF_URL=http://localhost:3151` for the before run, which is what turned the
self-wake pacing on) and runs `batched.spec.ts`: Google Chrome headed at 1440x900, one 12-team
solo mock, 60 s clock, the human in seat 7 picking 1.5 s after her turn is revealed, 36 picks (3
human, 33 bot). Every instant is the browser's wall clock at the `EventSource` receipt, at the
wall tile's DOM arrival (a MutationObserver on `quilt-pick-cell` by accessible name), at the top
strip's `data-turn` flip and at the dock's `advisor-recomputing[data-active]` flip; `analyze.mjs`
turns `run.json` and the server's pick-path lines into the table. The before bundle was built
from `a8651b1f` in this worktree (`NEXT_DIST_DIR=.next-before`), the after bundle from `ce40b7b7`
(`.next-e2e`). Postgres 17, Redis 7 and pgbouncer from the repo's compose file, Postgres mapped to
5442 because another project's container holds 5432 on this machine.

The before run is the fix round's final state as it behaves on the dev stack, where the self-wake
chain is never refused; production's failure mode (four picks, then a wait for the minute cron)
cannot be reproduced locally and is documented in the fix ledger's investigation.

| measure (p50 / p90 / max ms unless noted) | before (`a8651b1f`) | after (`ce40b7b7`) | target |
|---|---|---|---|
| bot-to-bot reveal gap at the client, error against the seeded delay | 9 / 29 / 119, 31 of 33 within 50 | 2 / 5 / 9, 33 of 33 within 50 | within 50 ms every time: met |
| first bot after a human pick, reveal lateness against its own stamp | 19 / 20 / 20 | 5 / 10 / 10 | |
| human pick request to the first bot reveal (the seeded delay itself dominates) | 675 / 960 / 960 | 765 / 870 / 870 | |
| human pick POST round trip | 21 / 23 / 23 | 32 / 49 / 49 (the batch is in it) | |
| dock ready after the human's turn began | 413 / 435 / 435 | 9 / 11 / 11 | ready before the turn begins: 9 ms after, the promotion's one render |
| server invocations that advance the draft, 36 picks | 41 self-woken job runs + 3 pick POSTs + the start | 3 pick POSTs + the start (4 batches) | one per human pick plus autopicks: met |
| `/assistant` calls | 41 (one per pick) | 4 (one per batch) | |
| long tasks | 0 | 0 | zero: met |
| frame receipt to reveal | 5 / 9 / 13 | 3479 / 6225 / 7766 (by design: the batch arrives in one breath, reveals on the seeded schedule) | |

Reports: `.lab/measure/before/report.txt`, `.lab/measure/after/report.txt` (untracked, this
worktree). The dock's 9 ms is the effect that promotes the staged advisor view after the render
that revealed the human's turn; the odds figures are never "updating" once her turn is on screen.

## Deleted, and why each is safe

- `src/jobs/defs/draft-advance-job.ts` (+test), `src/draft-service/pacing.ts` (+test): the
  per-pick pacing job and its pacer. Safe: no bot pick is ever due in the future any more; the
  batch lands them in the human action's commit. A pending `draft-advance` row left in a
  production queue dead-letters as "no definition", loudly, once; none can be enqueued again.
- `src/jobs/self-wake.ts`, `src/jobs/self-url.ts`, `src/jobs/run-handler.ts` (+tests),
  `src/app/api/jobs/run/route.ts`: the self-wake chain and its route, the thing Vercel refused at
  the fifth hop. Safe: nothing enqueues a job due in seconds any more; the minute tick and the
  local runner claim everything else as before. `JOBS_CONFIG.selfWake*` and `pacingChainGraceMs`
  went with them; `jobs/store.ts` lost `claimJobById`, `isJobPending`, `retirePendingJobs` and
  `runner.ts` lost `runJobById`, all of which only the self-wake called.
- `src/draft-service/ticker.ts` (+test), the `getDraftTicker` edge and its start in
  `instrumentation.ts`, `DRAFT_SERVICE_CONFIG.tickIntervalMs` and `tickWarnIntervalMs`: the dev
  per-second heartbeat. Safe: its bot lane is the batch; its expiry and auto-start lanes are the
  sweep's, on every host (locally `npm run jobs:runner`, as production's tick); its house
  reconcile and mock retention lanes MOVED to the sweep job (`draft-sweep-job.ts`), which had never
  run them on Vercel. `liveDraftsQuery` moved to `src/draft-service/live-drafts.ts` unchanged.
- `MockBotDriver.driveBotPick` and the driver's `store` dependency: the ticker's bot lane. Safe:
  `botTurn` (was `dueBotPick`, `dueAtMs` now `revealAtMs`) is the one computation left, read by
  the store's batch and the advance funnel.
- The Redis facts store and its lock (`createRedisRoomFactsStore`, `roomFactsOnce`,
  `ADVISOR_CONFIG.facts`): replaced by the `draft_room_facts` row. Safe: a viewer who reads before
  the writer computes once, which is what a miss always cost; nothing waits on a lock.
  `serializeRoomFacts`, `deserializeRoomFacts` and the wire form stay, unchanged.
- The sweep's pacing gate (`isPacingChainLive`, `pendingPacingJobs`, the `paced` tally) and
  `DRAFT_ADVANCE_CONFIG.minPickSpacingMs` (the wire floor): the sweep takes any live draft again,
  and the floor was a property of a wire that now carries a batch. `ApplyOptions.followThrough`
  and `AdvanceOptions.followThrough`: only the stream's loop and the job passed them.
- `advance.ts`: the bot due lane, `nextDueInstantMs`, `earlierDueMs`; `nextDueAt` names the
  deadline only.

## Rulings

- Ruling: a pick's stamp IS its reveal instant; no separate `revealAt` field rides the wire. Why:
  the batch stamps every bot pick at `turnStartedAt + delay` exactly as the drivers did, so the
  stamp is the instant by construction, the snapshot path needs no new field, and one number
  cannot drift from another. Cost if wrong: a reveal keyed off the wrong instant, which the
  measurement above would show as a gap error.
- Ruling: the facts are computed after the response (`after()`), not before it, and the advisor
  asks at the first reveal. Why: computing before the response would delay every viewer's frames
  by the compute; asking at the first reveal (at least one seeded delay after the commit) reads
  the row the pick's own invocation wrote by then. Cost if wrong: an `/assistant` miss computes
  in the request, ~450 ms, still inside the reveal window of a batch of two or more.
- Ruling: the house reconcile and the mock retention sweep move into the sweep job rather than
  vanish with the ticker. Why: the ticker was the only thing that ever ran them, on a dev process
  only; deleting it silently would lose them locally, and production never had them. FLAGGED for
  the founder: production's minute sweep now restocks the house shelf (`ensureHouseCatalog`) and
  clears expired mock rooms for the first time.
- Ruling: `payloads.ts`'s pick slot enum gains `SUPERFLEX`. Why: `RosterSlotType` has it and the
  wire schema did not, so a superflex pick failed the parse and cost a resync; the reveal module
  builds frames from `CompletedPick` and the types would not meet otherwise.
- Ruling: the dev database's drizzle ledger was one row behind its schema (0088's table existed,
  its ledger row did not; `drizzle-kit migrate` fails silently on the re-create). Applied 0089 by
  hand and recorded both rows. Not this round's bug; stated so the next migrator is not surprised.

## Gates, as run

- `npx tsc --noEmit`: clean.
- `npx eslint` over `src/draft-service src/jobs src/mock-draft-service src/draft-room
  src/db/schema.ts src/instrumentation.ts src/app/api/drafts src/app/api/leagues
  e2e/solo-mock-pace.spec.ts`: clean; the one warning printed is `trades/[tradeId]/veto/route.ts`'s
  unused `req`, which predates the round.
- Replay pins and source guards, by path: `vitest run src/mock-draft/bots.test.ts
  src/draft-engine/autopick.test.ts src/integrity/*.source.test.ts src/design/*.source.test.ts
  src/help/glossary.source.test.ts src/projections/register/wall.source.test.ts
  --no-file-parallelism`: 19 files, 3382 tests, all passed (`PIN_BOT_DELAYS_MS`,
  `PIN_LEGACY_BOT_PICKS`, `PIN_SURPLUS_CLOCK_PICKS` byte for byte).
- The measurement above.
- `e2e/draft-room-sideline.spec.ts` and `e2e/solo-mock-pace.spec.ts` on port 3161 (`VERCEL=1
  E2E_BASE_URL=http://localhost:3161 npx dotenv -e .env.local -v STATS_PROVIDER=mock -- npx
  playwright test <the two specs>`, the `.next-e2e` bundle, the suite's own global setup): 3 of 3
  passed, the pace spec's 12-team solo mock drafting to completion in 2.3 min with no two
  consecutive bot tiles within 300 ms at the browser.

## Not done, and what the suite phase owes

- No new tests, per the ruling. `src/draft-room/state/reveal.ts` sits in a 100%-coverage-gated
  directory with no test of its own; the client hook's reveal queue and the advisor's staging are
  proven by the measurement, not a unit. The suite phase owes those.
- Existing tests were edited only to compile and were not run. Ones whose assertions describe
  the old pacing and will need the suite phase's hand: `advance.test.ts` "a deferred all-bot
  room reopened much later starts on the first advance and drafts through on the following
  ones" (it drafts through in the start's own commit now), `draft-sweep-job.test.ts` "one sweep
  starts a due mock room AND advances an abandoned in-progress draft" (the start batches its
  bots), `api-routes.test.ts`'s mock-room expectations about a bot on the clock after a start,
  and `mock-draft/config.test.ts`'s `maxBotPicksPerTick` / `sweepIntervalMs` pins (the knobs are
  now unread; left in `MOCK_CONFIG`, to be pruned with their pins).
- The dock's odds during a batch: the previous turn's figures dim with "updating" while the
  bots reveal (honest: they are the pick before's) and the new figures appear with the human's
  turn. Not measured as a felt experience by the persona panel.
- The snapshot path's hidden players rejoin `availablePlayerIds` at the END of the list, not at
  their rank: the dock's "best left on our board" fallback (used only when the advisor has no
  view) can name a lower-ranked man during a reveal window a viewer joined mid-way. The stream
  path keeps rank order exactly.
- A clock skew larger than a seeded delay between a browser and the server would shift reveals;
  the offset is measured off the stream's stamps and is zero until the first frame.
- `MOCK_CONFIG.maxBotPicksPerTick` and `sweepIntervalMs` are unread; their docblocks still speak
  of the ticker.

## Commits

`ce40b7b7` the batch, the reveal, the facts row, the deletions; `b54c1f81` the existing suites
reconciled to compile; the ledger last. Never merged to main here; no production write of any
kind was made.

## Fix round (whole-branch review, verdict merge after fixes)

Input: `scratchpad/batched-bots-review.md` (range `a8651b1f..cc266852`). One commit per finding.

- **H1, `f1b84fc9`.** The browser's offset from the server is unset until measured, measured
  from every answer the server stamps (a snapshot's and an action's new `servedAt`, every frame's
  publish stamp), the smallest winning whichever sign it has. A tab that loads mid-batch measures
  from its snapshot, before any frame.
- **H2, `f1b84fc9`.** `admitMakePick` (`draft-engine/admit.ts`, command time only) refuses a
  MAKE_PICK stamped before `turnStartedAt`: "The picks before yours are still landing." The room
  offers the turn only at the last reveal on its corrected clock. Ruling on the way: the
  advisor's live-room continuation (`sim/continue.ts`) stamped every simulated pick at the inert
  `SIM_INSTANT`, which the guard refuses against a future `turnStartedAt`; the first skewed run
  showed every facts compute failing and the dock in its error state. `8a031154` stamps the
  continuation's picks at the turn's own start (inert to everything the table reads). Deviation
  stated: `continue.test.ts` and `room-odds.test.ts` (2 files, 19 tests) were run once to check
  the stamp change against their pins; both passed.
- **M4, `837f2c3f`.** `resolveBots` opens only for a bot with a legal pick (`choosePick()`
  non-null); a resolve refused by a concurrent commit reloads and continues, and only a refusal
  against an unmoved log counts toward the wedge breaker.
- **M5, `f5ea91fb`.** The invocation that writes the facts publishes `draft.facts` (`{ draftId,
  sequence, ready }`); the room records the newest settled sequence (a snapshot counts as its own);
  the advisor asks `/assistant` only once that reaches the committed sequence, with an 8 s
  ceiling (`ADVISOR_ROOM_CONFIG.factsWaitMaxMs`) for a frame that never comes. Never two
  simulators. The interpretation of "the response carries the facts when ready within the
  request": the facts are computed after the response by ruling, so the response never carries
  them; the frame is the signal, and a snapshot load asks at once (its facts were written with
  its last commit).
- **House retire flag, `88f29adb`.** `HouseFactoryDeps.retire`, the sweep passing
  `houseRetireEnabled(process.env)` (`HOUSE_RETIRE_ENABLED=1`/`true`, default off everywhere);
  the spawn half runs as it always did; `.env.example` documents it.
- **LOWs, `aff4193c`.** The eight stale docblocks; `MOCK_CONFIG.maxBotPicksPerTick` and
  `sweepIntervalMs` removed with their pins in `config.test.ts`. LOW 6 (rank order on the
  snapshot path, no countdown before a start batch's first reveal), LOW 7 (the upsert's key-share
  wait, latency only), LOW 10 (an all-bot deferred room drafts inside one commit) and LOW 11
  (no unit for `reveal.ts`) stand as stated. LOW 9's Vercel `JOBS_SELF_URL` is dead and is the
  founder's to remove per environment (no cloud change was made here).

### The skew measurement (`.lab/measure/after-skew`, bundle from `8a031154`)

`MEASURE_SKEW_MS=2000 MEASURE_RELOAD_AFTER_PICK=2 run.sh after-skew .next-e2e`: the browser's
`Date` runs 2 s ahead of the server (the recorder's own instants stay real), and the tab is
reloaded 1.2 s after the second human pick, mid-batch.

| measure | after-skew |
|---|---|
| bot-to-bot reveal gap, error against the seeded delay | 1 / 12 / 600 ms, 32 of 33 within 50 |
| the one outside | picks 1 and 2 revealed together at the room's first paint (1,021 ms after open, both stamps already past): a viewer joining mid-batch reveals everything already past at once, by design |
| picks 19 to 30, revealed after the mid-batch reload | on cadence (pick 21: 584 against 569 seeded; 22: 783 against 794), then the turn |
| first bot after a human pick, lateness against its stamp | 7 / 7 / 7 ms |
| dock ready after the turn began | 8 / 12 / 12 ms |
| facts computes / `/assistant` calls / long tasks | 4 (one per batch) / 5 (open, reload, three batches) / 0 |

Gates after the fix round: `tsc` clean; eslint clean on every touched path (the pre-existing
`veto/route.ts` warning aside); replay pins and the 17 source guards, 19 files, 3382 tests,
passed, the new refusal string inside them.
