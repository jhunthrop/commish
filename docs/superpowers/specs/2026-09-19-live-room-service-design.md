# Live Room Service Design (2026-09-19)

**Status:** founder decision 2026-09-19, after the self-wake's 508 finding: time gets exactly one owner. A small always-on process owns every live draft room. Vercel keeps pages, the API and the human pick path. Rejected: moving the app off Vercel, Cloudflare Durable Objects, an outside scheduler.
**Inputs:** `scratchpad/draft-room-performance-phase1.md`, `scratchpad/draft-room-performance-fix-ledger.md` (the "fix ledger"), the job-system and advisor specs, the code named inline. Main at `d42ea76d` carries the performance round.

## 1. Goal and the measured problem

A room advances at its seeded pace whether or not anyone watches, every pick reaches the wire within 150 ms of its due instant, and the stream stays open for the whole draft.

The harness round got a paced room to due-stamp-to-receipt 22 / 31 / 51 ms (p50 / p90 / max) and a 519 ms gap floor with one self-woken invocation per pick (fix ledger, item 3b). Production refused the design: every request a function makes to itself extends the `x-vercel-id` chain, the proxy answers `508 INFINITE_LOOP_DETECTED` at the fifth hop, and `after()` inherits the chain. Room `e63dcd57` advanced in runs of four or five picks per external origin, then waited up to a minute for the cron; a five-minute solo draft took fourteen. Before that round the stream invocation carried the pacing loop and a 697 ms p50 advisor warm on one event loop, the founder's "hang, then two picks at once" (Phase 1). The dock's odds figures sit at 462 ms p50 against a 250 ms criterion.

The four-option comparison recommended a small always-on worker as the only option meeting the pace, the unwatched room, and no new vendor in the pick path. This spec is that worker, widened to own the room's clock, bots, facts and stream.

## 2. Boundary

**The API (Vercel) owns:** authentication and membership (`src/app/api/drafts/[draftId]/_shared.ts`), `POST /api/drafts/[draftId]/actions` through `applyAction` with its row lock and publish (`src/draft-service/store.ts`), queue and slot writes, the snapshot, `/players`, `/assistant`, chat, and the league stream route for pages outside a live room.

**The room service owns:** for each leased draft, the state in memory, the clock, bot pacing, autopick on expiry, deferred starts, the facts compute, the room's stream. It is the only process that arms a timer for a draft.

**The cron owns:** reconciliation. The minute sweep (`src/jobs/defs/draft-sweep-job.ts`) leaves a leased room alone and advances one whose lease is missing or expired, as it leaves a paced room alone today (`isPacingChainLive`). Auto-starts, kickoff rolls, mock retention and the wake set stay with it.

**The client owns:** folding frames by sequence (`src/draft-room/state/apply-event.ts`), the refetch on a gap or reconnect (`use-draft-room.ts`), the optimistic pick.

**Invariant: reads never advance state.** `advanceDraftNow` leaves `GET /api/drafts/[draftId]` (`route.ts:169`) and `/players`. A read replays the log and answers. No request path applies a `TIMER_EXPIRE`, a bot `MAKE_PICK` or a deferred start.

## 3. The room process

One Node process, `src/room-service/main.ts`, wired over the modules the routes use: `createDraftStore` with its own `afterApplied`, `createMockBotDriver`, `createDraftAdvancer`, the publisher, the presence store. It holds rooms keyed by draft id.

**Adoption.** Every second the process reads the wake set (`src/jobs/wake.ts`, Redis only). A `draft:<id>` member or `drafts:scheduled` due within `adoptLookaheadMs` (60 s) triggers one indexed query for in-progress or due drafts with no live lease, then a lease attempt per row. The store already registers every action's next deadline there (`noteWake`), so an idle service issues zero Postgres statements and Neon can still suspend.

**Lifecycle.** On adoption the room loads through the store, verified against `MAX(sequence)` (`store.ts:331`). A `scheduled` room arms a start timer at `mock_rooms.starts_at` or `drafts.kickoff_at` and fires through the seams `startIfDue` uses (`src/draft-service/advance.ts:151`). An `in_progress` room arms one timer at `nextDueInstantMs(state, mockDriver)` (`advance.ts:314`): the on-clock bot's seeded due instant or the deadline, whichever is earlier. On fire it calls `advancer.advance(draftId, now, { maxActions: 1, followThrough: false })`, which stamps the action at its due instant (`advance.ts:190`) and publishes through the store, then re-arms from the fresh state. On `complete` the room releases its lease, keeps viewer sockets open for `completeLingerMs` (60 s), then closes them.

**Bot pacing from the snapshot.** The due instant and the pick come from `dueBotPick` (`src/mock-draft-service/driver.ts:280`): the seeded think delay off `botDelayStreamKey`, the pick stream cursored off the log. The room touches no RNG the drivers do not already use, so `PIN_BOT_DELAYS_MS` (`bots.test.ts`), the autopick pins and `src/draft-engine/replay-pins.fixture.ts` pass unchanged. The wire floor `DRAFT_ADVANCE_CONFIG.minPickSpacingMs` (300 ms, `config.ts:87`) moves to timer arming: an instant already past fires no sooner than the floor after the last landed action; stamps are untouched.

**Expiry and the overnight pause.** The deadline timer is armed at `currentDeadline(state)` (`src/draft-engine/selectors.ts:407`), which already folds the pause window through `deadlineAfter`; a paused turn is a timer that fires at 5 AM Eastern. Autopick and skip stay the reducer's. Timers are `setTimeout` on the main thread, one per room, `lateMs` logged on every fire.

**Facts, once per sequence.** After every accepted action, its own or one it observes (section 6), the room hands the state to a worker thread pool that runs `publishRoomFacts(db, state)` (`src/draft-service/assistant/service.ts:129`) into the memo and the Redis facts store and returns the wire string (`serializeRoomFacts`, `facts-store.ts:68`). The main thread sends a `draft.facts` frame to every viewer. Workers, because the compute is 383 ms p50 per pick on the harness machine (fix ledger, item 3b) against a 700 ms mean bot delay: one room's facts are most of a core, and timers must stay within milliseconds. Pool size is cores minus one, at least one. A viewer's `/assistant` read is then a store hit.

## 4. Ownership

**Schema, migration `drizzle/0089_draft_room_leases.sql`:**

```
draft_room_leases
  draft_id     text PK references drafts(id) on delete cascade
  owner        text not null    -- hostname:pid:uuid8, the jobs runner's shape
  origin       text not null    -- the owner's public https origin, for stream routing
  generation   bigint not null  -- fencing token, +1 per acquisition
  acquired_at, renewed_at, expires_at  timestamptz not null
index (expires_at)
```

**Acquire:** `INSERT ... ON CONFLICT (draft_id) DO UPDATE SET owner, origin, generation = generation + 1, ... WHERE draft_room_leases.expires_at < now() RETURNING generation`; zero rows means somebody holds it. **Renew:** `UPDATE ... WHERE draft_id = $1 AND owner = $2 AND generation = $3`; zero rows means the lease is lost and the room drops its timer and subscriber at once. **Cadence:** a room due inside `holdHorizonMs` (10 min, the ceiling `JOBS_CONFIG.selfWakeChainMaxMs` argues for) renews every 5 s with a 15 s TTL; a slower room every 60 s with a 180 s TTL, so a week-long slow draft costs sixty statements an hour and a takeover lag under two percent of its clock. **Release:** on `complete` and on SIGTERM the owner sets `expires_at = now()`.

**Takeover.** A new owner holds nothing but the log. It replays every action from `START_DRAFT` (`src/draft-engine/replay.ts`), re-derives the bot streams from the log (`driver.ts:190`) and the due instant from the state, and arms its timer. Two owners can only compute the same next action with the same stamp (`advance.ts`, "catch-up is byte-identical").

**Split brain.** Correctness never rests on the lease; it only prevents duplicate timers. A paused process that wakes believing it owns a room sends its action through `applyAction`: `drafts FOR UPDATE`, the in-lock replay against `MAX(sequence)`, `admitCommand`, the unique index (`store.ts:460-493`). A stale `TIMER_EXPIRE` is refused because the new turn's deadline is later; a stale bot pick because the seat is off the clock. The loser logs `room.lease.lost` and drops the room.

**Sharding.** Launch is one machine. Each instance adopts up to `maxRoomsPerInstance` (initial 8, set by the rollout measurement) first-claim; `origin` on the row routes a viewer's stream. More machines is `fly scale count`. Rooms never move while a lease is live.

**Death mid-pick.** The transaction commits or it does not. If it committed and the process died before publishing, the viewers' sockets die too, the browser reconnects (`retry: 250`, `sse.ts:30`), and `onOpen` refetches the snapshot (`use-draft-room.ts:284`), which reads the committed log. The new owner adopts within one TTL plus the restart, recomputes facts, arms the next timer. Longer outages fall to the sweep.

## 5. The stream

**SSE, not WebSocket.** The client already has a ref-counted `EventSource` manager with hidden-tab suspension (`src/event-stream/league-stream.ts`), the `Last-Event-ID` resume, zod-validated frames (`src/draft-room/state/payloads.ts`) and a fold that answers a gap with a resync. Every room message is server to client; chat's upstream is a POST. A WebSocket would rewrite all of that for nothing.

**The endpoint.** `GET https://<origin>/rooms/<draftId>/events?ticket=<t>` on the room host, built from `createLeagueEventStream` (`src/lib/realtime/sse.ts`) with the planned close disabled: no function cap, so the connection lives for the whole draft. It reads the league key and the caller's user key on one XREAD as today, so notices and chat ride it. Presence uses the same `presenceLifecycle` and Redis hash.

**Auth.** The AuthKit cookie belongs to `trycommish.app`. The snapshot route, already membership-gated, mints a ticket: base64url of `draftId.leagueId.userId.exp` plus an HMAC-SHA256 under `ROOM_STREAM_SECRET`, verified with `timingSafeEqual` in the pattern of `src/jobs/tick-auth.ts`. TTL 12 hours; an expired ticket answers 401; the host never logs a query string. CORS allows the app origin only.

**Frame contract.**

| frame | id | source | payload |
|---|---|---|---|
| `draft.*` (the seven in `payloads.ts`) | stream id | relayed from Redis (`src/draft-engine/events.ts`) | as today, `clock.sequence` inside |
| `draft.facts` | none, synthesized like `draft.resync` | the room, after its facts compute | `{ draftId, sequence, computedAt, facts }`, `facts` in the store's wire form v1; the latest replays to a viewer on open |
| `draft.resync`, `presence.changed`, `chat.*`, `notice.created`, keepalive | as today | as today | unchanged |

`draft.facts` is not XADDed: 45 KB per sequence (fix ledger, the `/assistant` body) times 180 picks would fill the league stream for nothing a resume needs; a reconnecting viewer refetches `/assistant` on open, a store hit. The type joins `REALTIME_EVENT_TYPES` and `payloads.ts` gains its schema, so the later client-derivation round consumes the payload without a contract change. This round the frame is the recompute cue: `useAdvisor` fetches on `draft.facts` at its sequence instead of on the pick (`use-advisor.ts:125`), removing the miss path and the lock polling.

**Reconnect and resync.** Unchanged: the browser retries, the server resumes from `Last-Event-ID`, `onOpen` refetches the snapshot. New: after three consecutive `error` events without an `open`, `useDraftRoom` refetches the snapshot and reopens at whatever `stream.url` it now says. A room host that is down holds no live lease, so the snapshot answers the Vercel route.

**Hidden tabs** are unchanged (`hiddenCloseMs`, 60 s). **The per-user ceiling** stays at `maxStreamsPerUser` (6): it bounds fds and Redis sockets on the room host as it did on a function instance.

**The exact client change.** `DraftSnapshotBody` (`src/draft-room/contract.ts`) gains `stream: { readonly url: string | null }`, filled from the lease row when the Vercel flag `ROOM_SERVICE_STREAM=on`, else null. `useDraftRoom` opens `snapshot.data.stream.url ?? `/api/leagues/${leagueId}/events`` (`use-draft-room.ts:259`). `EVENT_STREAM_CONFIG.isCarrierUrl` accepts `/rooms/<draftId>/events` on any origin. Nothing else changes.

## 6. Human actions

`POST /api/drafts/[draftId]/actions` stays on Vercel unchanged. Its `applyAction` publishes the frames after the commit (`store.ts:667`).

**How the room learns: Redis subscribe.** The room already holds one subscriber per owned room on the league key (`src/lib/realtime/subscribe.ts`) because it relays. A `draft.*` frame whose `clock.sequence` exceeds the held sequence means another writer moved the log: the room reloads through the store, re-arms, and computes facts. A DB poll was rejected: 100 ms polling is ten statements a second per room against Neon for a fact Redis delivers in a millisecond. Each renewal also reads `MAX(sequence)` and reloads on a mismatch, the reconciliation for a lost frame.

**Serialization.** The existing guards, nothing new: `drafts FOR UPDATE`, the in-lock load against `MAX(sequence)`, `admitCommand`, the unique index (`store.ts:404-493`). A room timer that fires against a log a human just moved is refused and treated as "the other writer got there first" (`advance.ts:227`); the room reloads and re-arms. The pick's follow-through on Vercel (`followThroughAppliedAction`, `src/draft-service/index.ts:81`) reads the lease row first and, when it is live, paces nothing and computes nothing.

## 7. Deployment

**Image.** `Dockerfile` at the root: `node:22-slim` (local is v22.11.0), `npm ci`, entry `npx tsx src/room-service/main.ts`, the shape `scripts/jobs-runner.ts` runs locally with `@/` imports. All dependencies install because the shared modules reach `next/server` through `src/lib/api/after-response.ts`, whose `after()` throws outside a request scope and runs the work detached by design.

**Fly, region `iad`.** Over Railway for three reasons: `fly.toml` and the workflow live in the repo, health check and restart policy included; Ashburn is where the production functions ran (`cle1:iad1` in the chains, fix ledger) beside the Neon and Redis integrations (task 1 verifies both hostnames first); a two-vCPU machine is a few dollars a month at published rates, verified at decision time. Railway's nearest region is another provider's network. **Size:** two vCPUs, 1 GB. **Deploy on push:** `.github/workflows/room-service.yml` runs `flyctl deploy --remote-only` on `main` after the Vercel production build, so the migration lands first; the service never migrates. **Secrets:** `fly secrets set` for `DATABASE_URL`, `REDIS_URL`, `ROOM_STREAM_SECRET`, `ROOM_SERVICE_ADOPT`, `ROOM_PUBLIC_ORIGIN`. **Logs:** `fly logs`, JSON lines.

**Health.** `GET /health` answers `{ ok, rooms, viewers, oldestRenewalMs, factsQueueDepth, redis, db }`; Fly checks every 15 s and restarts after three failures. SIGTERM: stop adopting, finish the in-flight action, release every lease, close sockets.

**Kill switch and fallback.** `ROOM_SERVICE_ADOPT=none`, or stopping the machine, ends adoption; leases expire within one TTL; the pacer and the sweep take leaseless rooms as they do today. `ROOM_SERVICE_STREAM=off` on Vercel routes every viewer back to the Vercel stream without touching pacing. After section 8's deletion the fallback is the sweep alone, minute pacing for every room, watched or not: the price of pure reads.

**Observability, per room.** One JSON line each: `room.adopt` (generation, sequence, adopt or takeover), `room.timer` (kind, dueAt, lateMs), `room.action` (sequence, kind, txMs, publishMs, published), `room.foreign` (from, to), `room.facts` (sequence, computeMs, queueMs), `room.lease.lost`, `room.release` (reason). The `pickPath` stopwatch stays behind `DRAFT_PICK_PATH_TIMING=1`.

## 8. Rollout

1. Ship the lease table, the service, and the lease guards on Vercel with `ROOM_SERVICE_ADOPT=listed` and `ROOM_SERVICE_STREAM=off`. Nothing changes until a draft id is in the Redis set `rooms:adopt`.
2. One production solo mock, listed: pacing on the room host, stream still on Vercel. Then `ROOM_SERVICE_STREAM=on` for the same mock.
3. Gate on the same harness (`scratchpad/fix/run.sh` and its scripts), dev stack first, then once on production: due stamp to receipt p90 under 150 ms; no two bot picks within 300 ms; timer lateness p90 under 10 ms; zero `open` events after the first at the browser's `EventSource` across a 180-pick draft; an unwatched room completing on time; the dock's odds figures against the 250 ms p50 criterion, met or stated with the number, since the facts compute is the floor and the shortlist re-fit is the next lever (fix ledger).
4. `ROOM_SERVICE_ADOPT=all`. Watch one real-league slow draft across a tier tightening.
5. Delete the self-wake path: `src/jobs/self-wake.ts`, `run-handler.ts`, `self-url.ts`, `src/app/api/jobs/run/route.ts`, the `draft-advance` job and `src/draft-service/pacing.ts` (a pacing job without a wake is a worse sweep), `advanceDraftNow`, `JOBS_CONFIG.selfWake*` and `pacingChainGraceMs`, `JOBS_SELF_URL`; `e2e/solo-mock-pace.spec.ts` becomes the service's spec.

## 9. Risks and what is not in this spec

- **CPU per room.** The facts compute bounds rooms per machine; the rollout measures one, two and four concurrent solo mocks and sets `maxRoomsPerInstance`.
- **One machine, one region.** A restart is seconds; a region outage is minute pacing. Acceptable for the data year.
- **Sockets.** One subscriber per room and one per viewer, as the functions had. In-process fan-out waits for a measured count.
- **Ticket in a URL.** Read-only, membership-checked at mint, expiring, never logged.
- **Not in this spec:** the client deriving the card from the pick log and the facts payload (the contract admits it); Sunday live scoring on this service; a WebSocket for chat; a slim bundle; the shortlist re-fit.

## 10. Task list, ordered, for the writing-plans skill

1. **Region check.** Record the Neon, Redis and Vercel function regions in the plan.
2. **Lease table.** `drizzle/0089_draft_room_leases.sql`, `src/db/schema.ts`, `src/room-service/lease.ts` (acquire, renew, release, `isLeaseLive`), four-lane DB tests.
3. **Lease guards on Vercel.** `src/draft-service/index.ts`, `src/jobs/defs/draft-sweep-job.ts`, `src/draft-service/ticker.ts` (the dev ticker's draft lanes yield to a live lease), tests.
4. **Reads become pure.** `src/app/api/drafts/[draftId]/route.ts`, `players/route.ts`, `api-routes.test.ts`.
5. **The room process.** `src/room-service/main.ts`, `room.ts` (state, timer, subscriber, the wire floor), `adopt.ts` (wake-set scan, claim loop, `maxRoomsPerInstance`), `config.ts` (every knob named here), `facts-worker.ts`, tests with an injected clock; replay pins unchanged.
6. **Stream on the room host.** `src/room-service/stream.ts`, `ticket.ts`, `src/lib/realtime/events.ts`, `src/draft-room/state/payloads.ts`, the snapshot route (`stream.url`), `src/draft-room/contract.ts`, tests.
7. **Client.** `src/draft-room/hooks/use-draft-room.ts`, `src/event-stream/config.ts`, `src/draft-room/advisor/use-advisor.ts`, hook tests.
8. **Health, shutdown, logs.** `src/room-service/health.ts`, `shutdown.ts`, `log.ts`, tests.
9. **Deployment.** `Dockerfile`, `fly.toml`, `.github/workflows/room-service.yml`, `.env.example`, `package.json` (`rooms:dev`), `docs/conventions.md`.
10. **Harness and e2e.** `scratchpad/fix/room-harness.ts` records `open` events and timer lateness; `e2e/live-room.spec.ts`.
11. **Rollout steps 2 to 4**, measurements recorded in the plan's ledger.
12. **Deletion** per section 8 step 5, `vercel.json` untouched (the cron stays), plus the tests that named the deleted modules.
