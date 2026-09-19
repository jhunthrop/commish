# Draft room performance, Phase 1 findings (measured 2026-09-18)

Measured by the sweep engineer on the dev stack (production bundle, VERCEL=1) and on production (trycommish.app, `vercel logs`, room 4cafd79a-3efb-47fc-82de-5cc8c78adda8, 10:01 PM Central), plus the founder's own Chrome trace on that room.

## Mechanism of the "hang then two picks at once"

- Bot picks are made by `runDraftAdvanceLoop`, an in-process `setTimeout` loop inside the `/api/leagues/[id]/events` SSE invocation. It lives only while a stream is open (280 s planned close, then a reconnect into a fresh invocation with an empty cache and memo). A room nobody is watching advances only on the minute sweep.
- After every sequence the same process runs `warmAdvisorRoom`: 731 ms p50 of synchronous CPU on a 12-team room (the 200-run simulation is 587 ms of that; the older "100 to 260 ms" figure in the advisor spec is stale). While it runs the pacing timer cannot fire and XREAD frames cannot relay; when it ends every due pick lands in one `applyDueWork` loop and the held frames relay together.
- `/assistant` runs in a different Vercel function (6 functions for 258 routes; the stream shares a function with `/api/jobs/tick`), so the per-process memo keyed draftId:sequence never serves it in production; every dock call re-simulates.
- Founder's browser trace: after the human's pick at 14.09, bot picks 14.10, 14.11, 14.12 rendered within 81 ms; 2,196 ms of nothing; 15.01 and 15.02 within 26 ms. Zero client long tasks.
- Production logs: stream invocations 03:01:24, 03:06:05 (planned close), 03:10:21; no stream 02:52:49 to 03:01:24 while the room sat frozen from 02:53:45 with due picks unapplied; the sweep dead-lettered at a 45 s timeout (02:56); "advance wedged" x10 in 7 days (two sweeps racing); `ioredis connect ETIMEDOUT` x50 in 7 days with `maxRetriesPerRequest: null` (a publish hangs rather than fails).
- Cold starts: none measurable (213 ms after 17 idle minutes versus 180 to 206 warm).

## Per bot pick, localhost

- Pick transaction 6 ms (6 statements, 1 to 3 ms of DB); publish to browser 3 to 6 ms.
- Due-stamp to receipt p50 87 to 190 ms, p90 692 to 1,287, max 1,501; pairs 6 to 55 ms apart; four transactions idle-blocked 690 to 1,069 ms mid-flight.

## Client, per surface, settle after frame receipt

- 0 long tasks; each frame commits in 6 to 7 ms and paints in 8 to 16 ms; frames are never folded.
- Turn chip 7 ms; sheet row 162; wall 236 (own pick 476); pool 423 (the reorder transition); dock "updating" 789 p50 / 1,655 p90 / 2,194 max, which is the `/assistant` round trip (673 / 1,239 / 1,592).
- Ranking of felt slowness: (1) the odds recompute wait, (2) animation stacking (pool about 400 ms, wall 240), (3) render cost, not a contributor.

## Room open

- `/players` payload 722 KB; 259 KB gzipped JS in 24 chunks; 1.3 to 1.9 s of open-time refetches; 95 headshots; first frame plus 1.5 s.

## Fix design agreed with the coordinator (founder: "fix it when we have all of the data")

1. The stream invocation relays only; nothing over a few ms of CPU on its event loop.
2. Room facts computed once per sequence on the pick's own invocation, written to Redis keyed draftId:sequence with a short TTL; `/assistant` reads and never simulates; a miss computes once under a lock.
3. Bot pacing as one invocation per pick through the owned job system: after a pick commits, enqueue the next bot's pick due at now plus botDelay with jitter from the seeded RNG (seed on the START_DRAFT snapshot, replay byte for byte, pinned with the engine round's replay fixture); the job's invocation makes the pick, publishes, computes facts, enqueues the next. The minute sweep is the safety net only. If the job system lacks second precision, add a due-time index and an in-invocation wake via `after()` for jobs due in under 60 s, cost stated. About 165 invocations per solo draft.
4. `observe()` ignores the loop's own pick; finite Redis retries with a fail-fast publish and a person-voice error; the sweep's 45 s dead-letter unreachable by a healthy room; the two-sweep race closed by the job lock.
5. Client: the pool's reorder and the wall's spring must not stack; every surface except the odds figures settles on the pick alone within 250 ms at p90.
6. Room open, only if cheap after the above: defer headshots below the fold, page the pool.

Acceptance: no synchronous work over 20 ms on the stream process across 36 picks; dock "updating" p50 under 250 ms from the pick frame; due-stamp to receipt p90 under 150 ms; no two picks within 300 ms; an unwatched room still advances on time.
