# Draft-room performance fix round: ledger

Worktree `agent-af90bc2dd9d83f373`, branch `worktree-agent-af90bc2dd9d83f373`, cut from main at
`137a9664` (`git merge-base --is-ancestor` confirms). Binding inputs: the Phase 1 findings
(`scratchpad/draft-room-performance-phase1.md`). The round brief named in the task
(`sideline-surface-round-brief.md`) is not on disk in the scratchpad; the gates and the waiting rules
are taken from the task text and the wave-two ledger's shape. The Phase 1 worktree
(`agent-abe317191f306ab70`) is gone; its harness scripts survive under `scratchpad/perf/` and an
abandoned Phase 2 attempt sits in `.claude/worktrees/draft-room-perf` (one commit, `cd84e75e`, plus
uncommitted files); both were read as reference only, nothing was taken from them verbatim.

## The harness, rebuilt (commit `1f60ddf6`)

Scripts: `scratchpad/fix/run.sh <run> [picks]` drives everything; `room-harness.ts` (Phase 1's,
imports repointed, the human's pick now chosen from the state route's own `availablePlayerIds`
rather than from stream frames, which missed picks landed before the stream opened and answered 409
three times on the first attempt), `analyze.js`, `surfaces.js`, `pick-path.js` (new: reads the
server's own stopwatch lines).

Server side, permanent and opt-in: `src/lib/timing/pick-path.ts` (`DRAFT_PICK_PATH_TIMING=1`) logs
`[draft] pick-path {json}` around `loop.advance` (with the armed timer's lateness), `publish`, and
`advisor.warm`. Off, the timer is the work itself.

Topology, the Phase 1 one: production bundle (`npx dotenv -e .env.local -v NEXT_DIST_DIR=.next-perf
-- next build`), `next start -p 3151` with `VERCEL=1` (dev ticker off, serverless pool), Postgres 17
in Docker with `log_min_duration_statement = 0` and `log_line_prefix '%m [%p] %a %v '` for the run
window only (`ALTER SYSTEM` one statement per `-c`; the first attempt put three in one `-c` and
Postgres refused the transaction block, so that run's Postgres log is empty), Redis 7 under
`redis-cli monitor`, installed Google Chrome headed at 1440x900 through `@playwright/test`, one
12-team solo mock, 60 s clock, seat 7, the human seat picking 2.5 s after coming on the clock, 36
picks (3 human, 33 bot). Every browser instant is `performance.timeOrigin + performance.now()` at
`EventSource` receipt; the publish instant is the frame's own `timestamp`; the due instant is the
payload's chained due stamp.

## Before (run `scratchpad/fix/baseline`, draft `548f3512`, 05:28:44Z to 05:29:20Z)

Server, per bot pick (basis `analyze.js`, n=33 bots; `pick-path.js` on `server.log`):

| stage | p50 / p90 / max ms |
|---|---|
| due stamp to the loop's status read (how late the pacing woke) | 234 / 663 / 930 |
| pick transaction BEGIN to COMMIT, wall (six statements, 1 ms summed) | 7 / 693 / 1143 |
| COMMIT to XADD | 1 / 2 / 649 |
| XADD to browser receipt | 2 / 3 / 4 |
| due stamp to browser receipt | 390 / 1057 / 1638 |
| gap bot to bot at the browser (configured 706 / 864 / 941, min 458) | 749 / 955 / 1505, min 8 |
| `advisor.warm` on the stream process, wall | 697 / 941 / 1137 (n=36) |
| `loop.advance` wall | 13 / 667 / 1152 (n=62) |
| the loop's timer lateness (armed instant to firing) | 0 / 411 / 784 |
| `publish` wall | 1 / 2 / 3 |

Stages over 20 ms on the stream process: 49 of 137. Coalesced pairs (two picks in one
`applyDueWork` loop, 8 to 12 ms apart at the browser): picks 4, 16, 29. Statement census over the
34 s window: 987 executes; `max(sequence)` 173, projections `DISTINCT ON` 66 and crosswalk 66 (two
per pick: the warm and the client's `/assistant`), advance status reads 66 (two per pick: the loop
wakes on its own pick's frame).

Browser, per surface after frame receipt (basis `surfaces.js`, settled p50 / p90 / max ms): wall
235 / 244 / 480 (own pick 480), sheet 153 / 171 / 173, pool 421 / 444 / 620 (the reorder, ~400 ms
of running animations), turn chip 6 / 8 / 23, clock 7 / 499 (its own countdown tick), dock call 7 /
705. Dock "updating" (`pool-recomputing[data-active]`) off at p50 861 / p90 2493 / max 4084 ms;
three never cleared before the next frame. `/assistant` round trip p50 825 / p90 1363 / max 2001 ms,
45-46 KB each. Zero long tasks; 4 React commits per pick frame (p90 7); receipt to first commit 6 ms.

Room open (basis `analyze.js` navigation section): `/players` 722 KB decoded; 24 JS chunks, 259 KB
gzipped; 132 headshot images; open-time refetches `/api/leagues/<id>` 1233 ms and `/api/drafts/<id>`
1170 ms (contending with the first warm on the same process); first pick frame at +1479 ms.

## The six items

Filled in per item below, before and after side by side, same harness, same command.

### Item 1: the stream invocation relays only (commit `8c4261e0`, run `scratchpad/fix/item1`)

What changed: the advisor warm left the stream's advance loop (`startDraftAdvanceLoopForLeague`
passes no `onSequence`); every accepted action now reaches a store post-commit hook
(`DraftStoreDeps.afterApplied`, opt-out per call through `ApplyOptions.followThrough`) which the
edge wires to compute the room's facts for the new state on the pick's own invocation after its
response (`runAfterResponse`: Next's `after()` in a request scope, detached outside one, both
proven); the stream's loop passes `followThrough: false`, so its process paces and relays and
nothing else; the simulation runs in chunks of `ADVISOR_CONFIG.simChunkRuns` (8) runs and yields
one macrotask between them (`simulateRoomOddsInChunks`, pinned byte-equal to the synchronous
table); the memo is single-flight per room state (`memo.test.ts`). Until item 3, a bot pick the
loop lands leaves its facts to the viewer's own request (single-flight, on the request path).

| stage (same basis as the baseline) | before p50 / p90 / max | after p50 / p90 / max |
|---|---|---|
| the loop's timer lateness | 0 / 411 / 784 | 0 / 17 / 109 |
| `advisor.warm` on the stream process | 697 / 941 / 1137, n=36 | none (0 lines) |
| `loop.advance` wall | 13 / 667 / 1152 | 12 / 453 / 853 |
| due stamp to the loop's status read | 234 / 663 / 930 | 63 / 327 / 770 |
| pick transaction wall | 7 / 693 / 1143 | 10 / 293 / 507 |
| due stamp to browser receipt | 390 / 1057 / 1638 | 185 / 793 / 968 |
| gap bot to bot at the browser (min) | 749 / 955 / 1505 (8) | 755 / 940 / 1335 (15) |
| coalesced pairs (two picks in one loop) | 3 | 1 |
| stages over 20 ms wall on the stream process | 49 of 137 | 20 of 103 |
| dock "updating" off | 861 / 2493 / 4084 | 736 / 1324 / 3299 |
| `/assistant` round trip | 825 / 1363 / 2001 | 725 / 1132 / 1670 |

Reading: the event loop is no longer held by the warm (lateness p90 17 ms), but `loop.advance`
still runs hundreds of ms of wall on this topology because locally the stream, the actions route
and `/assistant` are ONE process: the viewer's own `/assistant` compute (its still-synchronous
`onClockShortlist` 97 ms, `inferSeatDrivers` 37 ms, `recommendNow` 96 ms, plus the chunked sim)
and the human pick's post-response compute sit on the same loop as the pacing timer. On Vercel
those are different functions (Phase 1: six functions, the stream beside `/api/jobs/tick`), so
the local "stages over 20 ms" is a ceiling, not the production number; the timer lateness is the
honest local read of the stream's own loop. The acceptance ("no synchronous work over 20 ms on
the stream process across 36 picks") is met for the work the stream itself does; the remaining
coalesced pair (pick 3, at room open) and the tail are what item 3 removes by taking the pacing
off the stream altogether. Browser surfaces unchanged (wall 235, sheet 151, pool 424, turn 7).

Hazards recorded on the way: three `api-routes.test.ts` tests fail at the base commit `137a9664`
too (verified by checking it out in this worktree): the mock fixture's `starts_at` is the literal
2026-09-10, which the calendar passed, so advance-on-read now starts the "unstarted" room, and the
process-wide bot driver's per-draft meta cache then outlives `truncateAll` between tests that
reseed one draft id. Fixed in this round's tests (a computed day-ahead start; the driver's
`invalidateDraft` in `beforeEach`, beside the store's own `invalidate`), not in product code.

### The simulation itself (commit on `src/draft-engine/roster-need.ts`)

Profiled (`scratchpad/fix/sim-profile.ts` under `node --cpu-prof`, the baseline run's draft at
pick 39, 12 teams, pool 1,719, 200 runs x 21 picks): `countByPosition` was 30.6% of self time and
the roster-need module 41%; it rebuilt a map over the whole pool to read at most sixteen roster
spots, twice per candidate role reader. An identity-keyed index over the pool object
(`positionIndexFor`) takes the simulation from 609-687 ms to 252-281 ms steady state on the same
draft (155.6 to 71.6 us per played pick), the autopick and bot replay pins byte-identical.

### Item 2: room facts once per sequence into Redis (commit `738a73cd`, run `scratchpad/fix/item2`)

What changed: `facts-store.ts`, keyed `advisor:facts:<draftId>:<sequence>`, TTL 10 min
(`ADVISOR_CONFIG.facts`), the compact wire form (a plain snake continuation as player ids, any
other run whole, the round trip pinned exact); the process memo stays in front as the single-flight
first level; `/assistant` reads memo, then store, and simulates only on a miss everywhere, under a
15 s NX lock, a contending reader polling 50 ms up to 5 s for the holder's write; every Redis
failure degrades to compute-here and logs once per streak. The service test proves a viewer on
another instance (memo reset, same store) reads instead of simulating.

This run's bundle also carries the engine index (`7181695b`, the simulation 650 to 250 ms), which
landed between the item 1 and item 2 builds; the two effects are not separated here, and the
locally-shared process benefits from both.

| stage | item 1 p50 / p90 / max | item 2 p50 / p90 / max |
|---|---|---|
| the loop's timer lateness | 0 / 17 / 109 | 0 / 3 / 77 |
| `loop.advance` wall | 12 / 453 / 853 | 8 / 33 / 273 |
| due stamp to the loop's status read | 63 / 327 / 770 | 4 / 60 / 141 |
| pick transaction wall | 10 / 293 / 507 | 8 / 98 / 163 |
| due stamp to browser receipt | 185 / 793 / 968 | 18 / 160 / 274 |
| gap bot to bot at the browser (min; configured min 459) | 755 / 940 / 1335 (15) | 683 / 852 / 930 (473) |
| coalesced pairs | 1 | 0 |
| `facts.publish` (the human pick's own invocation, after its response) | 649 / 1049 | 530 / 686 |
| dock "updating" off | 736 / 1324 / 3299 | 476 / 627 / 1246 |
| `/assistant` round trip | 725 / 1132 / 1670 | 462 / 596 / 1213 |

Reading: on this topology the store is not what moved the numbers (one process, so the memo
already served every viewer); it is what makes production behave like this run, where `/assistant`
and the pick's invocation never share a process. The dock is still bounded by the compute that
starts at the pick's commit: `/assistant` after a bot pick is the miss path (the stream's loop
opts out of the follow-through until item 3 takes pacing off it), 462 ms p50 of which the chunked
simulation is about 250. Not yet at the 250 ms p50 criterion; item 3 moves the compute onto the
bot pick's own invocation. Browser surfaces unchanged (wall 233, sheet 174 p90, pool 462, turn 8).

### Item 3: bot pacing as one job invocation per pick (commits `b16a2097`, `78c53892`; runs `scratchpad/fix/item3`, `item3b`)

What changed: `draft-advance` job (`src/jobs/defs/draft-advance-job.ts`), paced by
`src/draft-service/pacing.ts` from the store's post-commit hook and from the job's own outcome,
keyed `draft-advance:<draftId>@<sequence>` (idempotent; an older pending job is retired as
`succeeded` with no run); the self-wake (`src/jobs/self-wake.ts`) POSTs `/api/jobs/run` after the
enqueuing invocation's response, the run handler answers 202 and sleeps until the instant in 5 s
slices that notice a retired job, then `claimJobById` + `runJobById`. The stream's advance loop,
`draftLoopTarget`, `observe` and the `sse*` config are deleted; the events route relays only. The
sweep leaves a room with a live pacing job alone (`pendingPacingJobs`, grace 30 s) and takes one
whose wake never came. Pacing is on where `VERCEL` or `JOBS_SELF_URL` is set; the dev ticker keeps
its rooms otherwise. The delay stream is pinned (`PIN_BOT_DELAYS_MS`, recorded through the
unmodified `botThinkDelayMs` before the move). The queue already had millisecond `run_at` and the
`(status, run_at)` index, so second precision cost no migration, only the caller at the instant.

Ruling 4's "observe ignores its own pick": moot, `observe` is gone with the loop (recorded here
rather than fixed twice).

First pass (`item3`, commit `b16a2097`): the chain held end to end, 40 self-woken invocations for
36 picks (33 bot picks, 3 human-deadline wakes retired within a slice, the start), no errors, no
dead letters, `job.advance` p50 13 ms, `publish` p50 1 ms, `facts.publish` p50 493 / p90 764 ms.
But on this one-process topology the numbers REGRESSED against item 2: due stamp to receipt p50
84 / p90 552 / max 1015 (item 2: 18 / 160 / 274), four coalesced pairs (picks 9, 11, 15, 28), the
gap's minimum 25 ms. The log says why: the sleeping wake's `setTimeout` fires late whenever the
previous pick's facts compute holds the loop in its still-synchronous stages (`onClockShortlist`
97 ms, `inferSeatDrivers` 37 ms, `recommendNow` 96 ms; the sim already yielded), and the client's
own reads (advance-on-read on every `/api/drafts/<id>` and `/players` fetch) then land the overdue
picks in one `applyDueWork` loop. Vercel's fluid compute serves concurrent invocations of one
function on one instance, so the run route's invocations share an event loop the same way: this
is structural, not local noise.

Second pass (commit `78c53892`): the seat drivers read one seat per turn of the loop, the shortlist
scores four candidates per turn (`recommendPickInChunks`, pinned byte-equal), the seat shortlist
memo is async and single-flight, a read that finds a live pacing job applies nothing, and the run
handler marks how late each wake fired (`job.wake`). Numbers below.

Second pass measured (`item3b`, commit `78c53892`, 42 self-woken invocations for 36 picks):

| stage | item 2 (loop) p50 / p90 / max | item 3b (jobs) p50 / p90 / max | criterion |
|---|---|---|---|
| due stamp to the pick's status read | 4 / 60 / 141 | 14 / 19 / 33 | |
| pick transaction wall | 8 / 98 / 163 | 4 / 7 / 12 | |
| due stamp to browser receipt | 18 / 160 / 274 | 22 / 31 / 51 | p90 under 150: met |
| `job.wake` lateness (the sleep's end against its instant) | n/a | 2 / 7 / 9 | |
| `job.advance` wall (over 20 ms: 0 of 38) | n/a | 8 / 14 / 19 | |
| gap bot to bot at the browser, min (configured min 514) | 473 | 519 | no two within 300 ms: met |
| stages over 20 ms on the stream process | 9 (its own loop) | 0 of 42 | met |
| `facts.publish` on the pick's own invocation | 530 / 686 | 383 / 480 / 638 | |
| dock "updating" off | 476 / 627 / 1246 | 474 / 537 / 578 | p50 under 250: NOT met |
| `/assistant` round trip | 462 / 596 / 1213 | 456 / 539 / 644 | |

`analyze.js` lists picks 7, 18 and 31 as "coalesced": those are the three human picks (a POST has
no status read of its own), not bot pairs; the 28 bot-to-bot gaps have a 519 ms floor. Invocations
per solo draft: one self-woken run per bot pick plus one per human turn (the deadline wake,
retired within a 5 s slice once she picks) plus the start: 42 for 36 picks here, about 165 bot
runs and 15 deadline runs for a full 12-team, 15-round solo draft, each alive for its sleep plus
about 400 ms of pick and facts work, and the minute cron's tick as before. An unwatched room is
proven at the unit level (`draft-sweep-job.test.ts`, `pacing.test.ts`: the chain needs no stream,
and the sweep takes a room whose wake never came); no browser was needed for the room to advance
in these runs except as a viewer.

The dock: the facts compute now starts on the bot pick's own invocation at its commit and takes
383 ms p50 (about 250 ms of chunked simulation, 100 ms of the on-clock shortlist, 37 ms of seat
drivers, the reads), then the viewer's own seat shortlist adds about 100 ms; the criterion needs
that whole chain under 250 ms from the frame. Stated rather than loosened; the next lever is the
shortlist's per-candidate board re-fit (`fitFor` over the whole evidence board thirty times), and
after that only the run count, which is a product number.

### Item 4: finite Redis retries, the fail-fast publish, the sweep's clock, no false wedge (commit `57b1774c`, run `scratchpad/fix/item4`)

What changed: `redisOptionsFor(role)` (`src/lib/realtime/redis.ts`): every connection retries twice
with a 5 s connect timeout, and a publishing connection cuts every command off at 3 s
(`REALTIME_CONFIG.maxRetriesPerRequest / connectTimeoutMs / commandTimeoutMs`); a subscriber keeps
the retry bound and no command timeout (its `XREAD BLOCK` is the wait). Worst case for one publish
is under 15 s (`redis.test.ts` pins it), so a sweep's attempt can no longer be held to its 45 s
timeout by Redis. `ApplyResult` carries `published`; the actions route answers `notice: "Your pick
is saved. The room may take a moment to show it."` when the room was not told (the sentence passes
the house copy rules, `copy.test.ts`); nothing on the client renders it yet (the room refetches on
its next resync, as it always did), which is stated here rather than hidden. The sweep reads the
executor's `deadlineAt` and stops `DRAFT_ADVANCE_CONFIG.sweepReserveMs` (8 s) before it, registering
every draft it did not reach as due now. The advancer's refusal breaker counts only refusals against
an unmoved log: a reload that finds the sequence moved is the other driver's progress (the Phase 1
"advance wedged" pairs were two sweeps racing one room), so the count starts over
(`advance.test.ts`, "two drivers on one room"). `observe()` is gone with the loop (item 3).

Measured (the harness exercises none of the failure paths; this run shows no regression): due
stamp to receipt p50 20 / p90 40 / max 150; wake lateness p50 2 / p90 3 / max 12; gap min 505
(configured 484); stages over 20 ms on the stream 0 of 42; dock 503 / 549 / 581; `/assistant`
482 / 537 / 565; wall 231 / 253, sheet 78 p90, pool 498 / 529 (item 5 next), turn 8 / 10.

### Item 6: room open, only if cheap (commit `3d15f3bd`, run `scratchpad/fix/item56`)

What changed: the face image (`avatar.tsx`) is `loading="lazy" decoding="async"`, so the browser
fetches the headshots near the viewport first and decodes them off the first paint. Not done,
because not cheap: paging the `/players` dictionary (722 KB decoded: every player's reasons and
laws ride the one-per-draft fetch by design, `players/route.ts`), and the two open-time refetches
of `/api/leagues/<id>` and `/api/drafts/<id>` (the room's own resync on stream open). Measured on
`item56` (basis `analyze.js` navigation): headshots fetched at open 132 (baseline) to 109; first
pick frame at +1242 ms (baseline +1479, item 3b +1250 or so); the `/players` body and the 24
chunks at 259 KB gzipped unchanged; the open-time refetches 353 to 574 ms (baseline 1170 to 1233,
which were contending with the warm on the same process, gone since item 1).

### Item 5: the pool's leave and the wall's spring do not stack (commits `50a6ef1d`, `<second pass>`; runs `item56`, `item5b`)

First pass: a leaving pool row is pinned absolutely inside the list at the offset it held, so the
rows below reflow in the same frame and their FLIP glide runs while the ghost fades (`out` 180 ms
alongside `in` 240 ms) instead of after it. Measured on `item56` the pool settled LATER: p50 634 /
p90 726 (item 4: 498 / 529), animation window 650 ms. Cause, read off the code: the ghost's removal
180 ms in re-renders the list while the rows below are mid-glide, and the FLIP measured
`getBoundingClientRect`, which carries the in-flight transform, so it played a second glide from
halfway. Second pass: the FLIP reads `offsetTop` (layout; transform-proof, scroll-proof), the same
map the ghost is pinned from. Numbers below.

Second pass measured (`item5b`, commit `7da3761d`; browser, settled p50 / p90 / max ms after
frame receipt, basis `surfaces.js`, 25 ms animation sampling):

| surface | baseline | item 4 | item 5b | criterion (p90 within 250 on the pick alone) |
|---|---|---|---|---|
| pool | 421 / 444 / 620 | 498 / 529 / 651 | 242 / 253 / 256 | 253: the `in` motion (240 ms) plus one frame, read at 25 ms sampling |
| wall | 235 / 244 / 480 | 231 / 253 / 478 | 244 / 253 / 494 | same reading; the own pick's celebrate (480 ms) is the max |
| sheet row | 153 / 171 / 173 | 13 / 78 / 641 | 13 / 90 / 281 | met |
| turn chip | 6 / 8 / 23 | 8 / 10 / 13 | 9 / 14 / 17 | met |
| dock call (dim) | 7 / 705 / 863 | 8 / 10 / 13 | 9 / 14 / 17 | met |
| odds figures (dock "updating" off) | 861 / 2493 / 4084 | 503 / 549 / 581 | 462 / 515 / 538 | exempt from the 250; stated |

The pool no longer stacks: its animation window fell from about 400 ms (leave, then reorder) to
224 ms (the two together), and the wall's spring runs alongside it inside the same 240 ms. Both
read 253 at p90 against a 250 criterion; the 3 ms is the recorder's own 25 ms sampling on top of
a 240 ms token, not a second motion. Zero long tasks in every run. Pacing on this bundle: due
stamp to receipt 26 / 40 / 107, gap floor 506, unchanged.

## Before and after, the whole round (baseline run against the last run on each measure)

| measure (basis: the harness above; p50 / p90 / max ms unless noted) | before (`baseline`) | after (`item5b`) | acceptance |
|---|---|---|---|
| due stamp to browser receipt, bot picks | 390 / 1057 / 1638 | 26 / 40 / 107 | p90 under 150: met |
| closest two bot picks at the browser | 8 ms (three pairs under 150) | 506 ms (none under 300) | met |
| the pacing timer's lateness | 0 / 411 / 784 (the stream's loop) | 2 / 3 / 12 (`job.wake`) | |
| synchronous work over 20 ms on the stream process | 49 of 137 stages | 0 of 42 | met |
| pick transaction wall | 7 / 693 / 1143 | 4 / 7 / 12 | |
| the room's facts compute, where it runs | 697 / 941 / 1137 on the stream | 383 to 399 / 471 to 480 on the pick's own invocation | |
| `/assistant` round trip | 825 / 1363 / 2001 | 442 / 501 / 571 | |
| dock "updating" off (the odds figures) | 861 / 2493 / 4084 | 462 / 515 / 538 | p50 under 250: NOT met, 462 |
| pool settled | 421 / 444 / 620 | 242 / 253 / 256 | p90 within 250: 253 (see item 5) |
| wall settled | 235 / 244 / 480 | 244 / 253 / 494 | 253 (same reading) |
| sheet row / turn chip / dock call settled, p90 | 171 / 8 / 705 | 90 / 14 / 14 | met |
| headshots fetched at open | 132 | 109 | |
| first pick frame after navigation | +1479 | about +1250 | |
| an unwatched room | advanced only on the minute sweep | one job per due instant, the sweep the safety net (unit-proven) | met |
| invocations per 12-team solo draft | one stream invocation per 280 s while watched, plus the minute tick | about 165 self-woken bot-pick runs, about 15 deadline runs retired within 5 s, plus the minute tick | stated |

Not met, with the number: the dock's odds figures at 462 ms p50 against 250. The chain from the
pick's commit is the facts compute (about 250 ms of chunked simulation, 100 ms of the on-clock
shortlist, 37 ms of seat drivers, the reads) on the pick's own invocation, then the viewer's own
seat shortlist (about 100 ms) on the request. The next lever is the shortlist's per-candidate
re-fit of the whole evidence board (`fitFor` thirty times over about 500 entries; a per-roster
memo of the placement and lineup value inside it), then the run count, which is a product number
the card states. Neither was taken in this round rather than loosen the criterion.

## Gates, as run at the end (worktree head after item 5's second pass and the e2e spec)

- `npx tsc --noEmit`: clean.
- `npx eslint` over every touched directory (`src/draft-service`, `src/jobs`, `src/lib/realtime`,
  `src/lib/timing`, `src/lib/api`, `src/projections/decide`, the engine and UI files touched, the
  three routes, the e2e spec): clean; the one warning printed is `trades/[tradeId]/veto/route.ts`'s
  unused `req`, which predates the round.
- `npx vitest run src/draft-service src/jobs src/lib/realtime src/draft-room src/mock-draft
  src/mock-draft-service src/draft-engine src/projections/decide src/lib/timing src/lib/api
  src/components/ui --no-file-parallelism`: 249 files, 2563 tests, all passed
  (`scratchpad/fix/vitest-final.log`). The replay pins (`autopick.test.ts`, `bots.test.ts`, the
  new `PIN_BOT_DELAYS_MS`) are inside that run.
- `e2e/draft-room-sideline.spec.ts` and `e2e/assistant-tab.spec.ts` on port 3161, the production
  bundle (`npm run e2e:build`) started with `VERCEL=1 CRON_SECRET=... JOBS_SELF_URL=
  http://localhost:3161` so the jobs pace: all passed. One run of the sideline desktop test failed
  first on "sheet names cut at 1440" (a name-width assertion on Your sheet, which rides its own
  windowed list, not `MotionList`; "Amon-Ra St. Brown" clipped) and passed on two re-runs; recorded
  as a pre-existing name-dependent hazard, not changed here.
- `e2e/solo-mock-pace.spec.ts` (new, same server): a 12-team solo mock, 180 picks, completes in
  2.5 min on the jobs' pacing with no two consecutive bot picks within 300 ms at the browser.
  Playwright's browser build for the repo's version (`chromium_headless_shell-1234`) had to be
  installed on this machine first.

## Commits, in order

`1f60ddf6` pick-path timers; `8c4261e0` item 1; `7181695b` the engine's pool index; `b0f27e45` the
api-routes fixture fixes; `738a73cd` item 2; `b16a2097` item 3; `78c53892` item 3 second pass;
`57b1774c` item 4; `50a6ef1d` item 5; `3d15f3bd` item 6; `7da3761d` item 5 second pass; the e2e
spec last. Never merged to main here; no production write of any kind was made.

## Review fix round (whole-branch review, verdict merge after fixes)

Input: `scratchpad/draft-performance-review.md` (range `137a9664..91be6b60`). Same branch, tests
first, one commit per finding; LOWs 5 to 7 taken.

**Finding 1 (HIGH), `ee8ac4b5` then `feeff9bc`.** The self-wake covered only a due time inside 60 s,
so a 90 s clock expired on the cron's minute. Ruling honoured with one stated ceiling: a sleeper
sleeps at most `selfWakeMaxSleepMs` (60 s), then re-arms a wake for the remainder (`SelfWake.wakeNow`
from the run handler), chaining until due, each hop ending within a slice when the human's pick
retires the job; the chain covers due times up to `selfWakeChainMaxMs` (10 min: every mock clock and
the real schedule's 90 s and ten-minute tiers), and the hour-plus tiers stay on the cron, where a
minute's lateness is under two percent and a 60 s hop chain over the eight-hour tier would be 480
idle invocations a turn. Pinned in `run-handler.test.ts`: a 90 s clock is two hops and a 180 s clock
three, both landing within one slice of 0:00; a hop retired mid-chain re-arms nothing.
*Invocations for a 12-human league on a 90 s clock, every clock run out:* two per turn (a 60 s hop
and a 30 s hop), 384 for 12 x 16, against 192 before (which never happened: before, those went to
the cron); when a human picks inside the first minute, one hop, retired within 5 s.
The 90 s e2e (`scratchpad/fix/pace90`) then exposed the round's symptom downstream and the second
pass closed it: finer facts chunks (two sim runs, one candidate per yield), one action per pacing
run, and a 300 ms wire floor on the next pick after a landed one (`DRAFT_ADVANCE_CONFIG.
minPickSpacingMs`); stamps untouched, pins green.

**Finding 2, `1bd35e91`.** The superseded branch re-paces from the room's current state (idempotent by
key, pinned: two superseded runs, one job); `isPacingChainLive`, shared by the sweep and
advance-on-read, reads a `running` job older than one sleep ceiling plus the grace (90 s) as dead.

**Finding 3, `a785cdfb`.** `realtime:resync:<draftId>` (TTL one stream life) set by the store's failure
sink through the edge (`noteDraftPublishFailure`); every league stream reads it on its keepalive and
synthesizes one `draft.resync` frame (no stream id) when the mark is newer than the one it opened
with; the room refetches on it (`use-draft-room`); the notice renders through the existing toast as
the league speaking: "The room lost its voice for a moment, catching up." Tests: the marker, the
stream's keepalive relay (once per mark), the hook's refetch and notice, the store's draft id.

**Finding 4, in `ee8ac4b5`.** `x-vercel-protection-bypass` rides the wake only when
`VERCEL_AUTOMATION_BYPASS_SECRET` is set (pinned both ways); a refused wake logs once per room.

**LOWs.** 5 `9a67d37a` (`botDelayStreamKey`, one label for the driver and the pin); 6 `75642b7b`
(the per-room pacing reads filter by `payload->>'draftId'` in SQL); 7 `879cae49` (`sweepReserveMs`
16 s, pinned above the publish worst case).

**Finding 1, third pass, `5d98db55`.** The second pass's 90 s run passed on the wire but 78 of 170
job runs applied nothing: an exhausted one-action advance reports `nextDueAt` as now, so the floor
job for the next sequence ran 300 ms later, found nothing due, and its true instant could never be
queued under an existing key; the spec's own polling reads were what kept the room moving.
`paceAfterAdvance` reads the next instant off the fresh state when the run stopped at its budget
(floored after a landed action) and paces from the outcome only when the run ended quiet.

### The 90 s clock, measured (`scratchpad/fix/pace90c`, third pass; basis: the pacing e2e's own
recorder at the browser's `EventSource`, the server's stopwatch lines in `server.log`)

12-team solo mock, 90 s clock, the human's first turn let run out, 180 picks in 3.9 min, passed.

| measure | value |
|---|---|
| the let-run clock's expiry at the browser, after 0:00 | 22 ms (criterion: within one 5 s slice) |
| the deadline job's chain | one 60 s hop, one 29.95 s hop, the run at 0:00 + 2 ms |
| `job.wake` lateness, all 166 runs | p50 2 / p90 4 / max 23 ms |
| `job.advance` wall | p50 8 / p90 89 / max 527 ms; every run applied exactly one action |
| bot picks within 300 ms of the previous | none (the wire floor holds; the spec asserts it) |
| 60 s first hops in the run | 15: one let run, fourteen retired within a slice by the human's pick |
| `facts.publish` on the pick's own invocation | p50 428 / p90 581 / max 2186 ms (unchanged in kind) |
| self-woken invocations for 180 picks | 181 job runs (one per bot pick, one per human turn, the chain's extra hop) |

Invocations for a 12-human league on a 90 s clock, stated: two per turn when a clock runs out (a
60 s hop and a 30 s hop), one when the human picks inside the first minute (retired within 5 s);
384 at most for 12 x 16, 192 at least, against the cron alone before this round.

Gates at the end of the review round: `tsc` clean; eslint clean on every touched directory (the
pre-existing `veto/route.ts` warning aside); `vitest` over the named scope plus
`src/projections/decide`, `src/lib/timing`, `src/lib/api`, `src/components/ui`: 250 files, 2580
tests, 0 failures (`scratchpad/fix/vitest-review3.log`); the replay pins inside it; the pacing e2e
on 90 s above. Commits of the round, in order: `ee8ac4b5` (finding 1 with finding 4's header and
per-room log, both in `self-wake.ts`), `1bd35e91` (2), `a785cdfb` (3), `9a67d37a` (LOW 5),
`75642b7b` (LOW 6), `879cae49` (LOW 7), `3ef3eced` (the spec's clock knob), `feeff9bc` and
`5d98db55` (finding 1's second and third passes, forced by the 90 s run).

## Production investigation: the self-wake's 508 (2026-09-19, read-only against production)

Room `e63dcd57`, production deployment `commish-4ldz7e2gy` (`d42ea76d`). Basis: `vercel logs
--json --source serverless` in 3-minute slices 13:12Z to 13:33Z (`scratchpad/prod2/window.jsonl`,
251 unique entries; the CLI batches entries into flush groups, so cadence is read from counts, not
stamps), and four preview deployments of a throwaway probe branch (`probe/loop-508`, never merged,
deleted after: `commish-hqdh0jn12`, `-tp9lexagf`, `-d1iwu2i0c`, `-hva721jjb`), read through the
founder's own Vercel-authenticated Chrome because previews sit behind SSO.

### 1. What applied the picks tonight

| invocation in the window | count | advances the room? |
|---|---|---|
| `POST /api/jobs/run` (a self-wake accepted, 202) | 159 | yes: one action each, the wake chain |
| `GET /api/jobs/tick` (the minute cron) | 19 | yes: claims the due `draft-advance` job a refused wake left pending, and its own `after()` restarts the chain |
| `GET /api/drafts/<id>` (the room's resync read, advance-on-read) | 4 | only past the 30 s grace of a pending job; otherwise it defers to the chain |
| `GET /api/drafts/<id>/assistant` | 38 | never (it reads facts; it advances nothing) |
| `POST /api/drafts/<id>/actions` (the founder's own pick) | 1 | his pick, and its `after()` starts a chain |
| `[jobs] self-wake refused ... status: 508` | 5 lines | once per room per instance, so at least five refusals, not five |

So the self-wake DID run in production for most picks (159 accepted wakes for a draft of about 180
picks), and the picks the founder watched arriving 0.6 to 1.3 s apart were wake-driven. What he did
not see: every chain is cut at its fifth hop (below), the job sits pending, reads defer to it for
the 30 s grace, and the minute tick resumes it: a room advances in runs of four or five paced picks
per external origin, then waits up to a minute. A 12-team solo draft that takes about five minutes
of bot time on the harness took over fourteen here.

### 2. What Vercel keys the loop detection on (measured)

- Every request a function makes to a Vercel deployment host arrives with the CALLER's
  `x-vercel-id` chain extended by the function's region: the browser's request is
  `cle1::<id>`, the function's self-call arrives as `cle1:iad1::<id>`, the next as
  `cle1:iad1:iad1::<id>`, and so on. The runtime stamps this on the outbound request itself;
  our own `x-vercel-id: probe` header is overwritten (the `strip` variant arrived with the
  accumulated chain regardless).
- The proxy refuses the request whose chain carries FIVE function hops: `508`, header
  `x-vercel-error: INFINITE_LOOP_DETECTED`, body `Infinite loop detected\n\nINFINITE_LOOP_DETECTED\n\n<x-vercel-id>`.
  Depths 0 to 4 answered 200; the fifth nested hop was refused, on two separate runs.
- A hop fired from inside `after()`, after the response has gone (the self-wake's exact shape),
  INHERITS the chain: the `detached` variant's runtime log shows hop 0 `cle1::`, hop 1 `cle1:iad1::`,
  ... hop 4 refused at `cle1:iad1:iad1:iad1:iad1:iad1::`. There is no "genuinely new request" from
  inside a function: the platform, not the code, supplies the chain.
- A different host is no reset: a preview calling the production alias's `/api/jobs/tick` got our
  own 401 (so it was reached) with `cle1:iad1::iad1::`, one hop appended.
- A depth cap of one in our own header changes nothing the proxy reads.

Therefore the self-wake as designed cannot pace a room past four consecutive picks on Vercel, and
the unwatched-room acceptance criterion ("an unwatched room still advances on time") is NOT MET in
production: an unwatched room advances five picks per cron minute (the tick's claim plus four
chained hops), then waits for the next tick.

### 3. The design changes: four ways to be called at a due instant

| | (a) external scheduler (Upstash QStash or equivalent) | (b) Vercel's own primitives | (c) one small always-on worker | (d) in-process pacing inside `after()` |
|---|---|---|---|---|
| mechanism | at each pick's commit, publish one message with a delay (or an absolute not-before) to `POST /api/jobs/run`; the call arrives from outside, no `x-vercel-id` chain, signed (`Upstash-Signature`, verified with the signing keys in env); retries and a dead-letter queue built in | Vercel Cron: one-minute floor, no change. Vercel Queues and the Workflow kit (durable `sleep`) were in beta at the time of writing and are the platform's answer to exactly this; not GA, so not a commitment the launch can rest on today (verify at decision time) | a single container (Fly, Railway, Render: one shared vCPU, 256 to 512 MB) running the existing job runner (`scripts/jobs-runner.ts`) with a sub-second claim loop over the queue the code already fills; the dev ticker's shape, which is the code path the whole suite already exercises; pages, API and streams stay on Vercel | the invocation that lands a pick (a human's POST, the tick, a read) loops in `after()`: apply, sleep the seeded delay, apply the next, claiming each `draft-advance` job so a racing loop is refused; stops at the function's max duration (300 s) or a human's clock, leaving the pending job for the tick |
| precision | seconds: the delay header is whole seconds, delivery jitter around a second; the 450 to 950 ms bot pace becomes 1 to 2 s (a product change, still lifelike) | Queues/Workflow: seconds in beta | milliseconds (a `setTimeout` on a warm process) | milliseconds inside a loop |
| unwatched room | covered, exactly | covered if adopted | covered, exactly | covered while a loop lives; a gap of up to 60 s after every 300 s window and after any instance death, until the next tick |
| cost per solo draft (about 180 messages) | about $0.002 at the pay-as-you-go rate (about $1 per 100k messages; the free tier's daily cap covers a few drafts a day); a vendor, a signing key, a webhook contract | included in the plan | about $5 to $10 a month flat for the container; the rest unchanged | function time for the whole loop: about five minutes of a held invocation per solo draft, a few cents |
| deploys | env keys on Vercel; QStash points at the production alias (previews need the protection bypass header, which QStash can send) | Vercel-native | a Dockerfile and a second deploy target off the same push to `main` (Railway/Fly GitHub deploys), health check, restart policy; one more thing that can be down, with the minute sweep still the backstop | none |
| what it fails to cover | sub-second pacing; a vendor outage stalls pacing to the cron (the sweep remains) | availability today | a worker outage stalls pacing to the cron (the sweep remains); one more host in the founder's operations | the gaps above; a deploy or an instance recycle mid-loop; function time billed while sleeping |

**Recommendation: (c), the small always-on worker running the job runner the code already has, with
a sub-second claim loop.** It is the only option that meets all three at once: the ruled pace (450 to
950 ms), the unwatched-room criterion, and no new protocol or vendor in the pick path. The queue,
the jobs, the pacer, the replay pins and the sweep stay exactly as merged; the only change is WHERE
the claim loop runs, and every Vercel-side driver (advance-on-read, the minute sweep) stays as the
backstop, so a worker outage degrades to today's behaviour rather than to a frozen room. It costs
one container and one more deploy target, against (a)'s second-granular pace and vendor contract
and (d)'s built-in minute gaps for the rooms nobody is watching, which are the rooms the criterion
is about. If the founder wants nothing off Vercel, (d) is the fallback, with its gaps stated in the
room's own terms: an unwatched solo draft pauses for up to a minute roughly every five.

Not implemented here; the founder decides between vendors and hosting. Until then, production
paces four picks per external origin and the tick resumes each break within a minute.
