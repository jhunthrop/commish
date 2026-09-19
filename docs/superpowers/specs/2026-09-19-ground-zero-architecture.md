# Commish ground zero: the 2027 platform

**Status:** founder decision 2026-09-19 (memory `rewrite-2027-ground-zero`). This document is the authority for the rebuild. It supersedes `2026-09-19-live-room-service-design.md`, whose lease, replay, frame contract and rollout thinking it keeps. The current app stays live and receives only fixes until cutover.
**Inputs:** `scratchpad/draft-room-performance-phase1.md`, `docs/design/2026-09-10-first-principles.md` and the Sideline mocks under `docs/design/mocks`, `docs/superpowers/specs/2026-09-07-draft-advisor-design.md`, `docs/money.md`, `docs/decisions/money-foundations.md`, `docs/research/2026-09-07-premium-research-tier-legal-questions.md`, the code named inline. Main at `0a89eac`.

## 1. Why

Every failure of the week was a property of stateless functions. Bot pacing lived in a `setTimeout` loop inside the SSE invocation, so a room nobody watched advanced only on the minute sweep. The same event loop ran a 731 ms p50 advisor warm after every pick, so picks landed in bursts: three within 81 ms, then 2,196 ms of nothing, then two within 26 ms (phase 1 findings, the founder's own trace). `/assistant` ran in a different function than the stream, so its memo never hit and the dock's odds sat at 789 ms p50 against a 250 ms criterion. The fix round moved pacing to one self-woken job per pick and production refused it: Vercel answers `508 INFINITE_LOOP_DETECTED` at the fifth hop of a function calling itself, so room `e63dcd57` advanced four or five picks per external origin and a five-minute solo draft took fourteen. Around that: `ioredis connect ETIMEDOUT` fifty times in seven days, "advance wedged" ten times from two sweeps racing, a stream client that never recovers from a refused reconnect.

The numbers that matter were also measured: the pick transaction itself is 6 ms, publish 3 to 6 ms, and the browser commits a frame in 6 to 7 ms with zero long tasks. The engine and the client are fast. The platform between them is what the week measured. The smoothness the founder wants lives in the client's reactivity model and in a process that owns time. That is the rebuild.

## 2. Principles

1. **One provider.** DigitalOcean for the app, the collector, Postgres and Valkey. One bill, one region (NYC3), one console.
2. **One language.** TypeScript end to end. The 150k-line research core (`src/projections` alone is 84,724 lines) is the product and stays as is.
3. **One process.** SvelteKit's handler, the WebSocket server and the job worker share one HTTP server on one Node 22 process. Nothing waits on a cron to wake.
4. **One owner for time.** A room's clock, bot pacing and expiry belong to the instance holding its lease. Reads never advance state. The sweep only reconciles a dead owner.
5. **The wire carries the log.** Every room frame is a pick-log entry with a sequence, or a synthesized frame the client can discard. The client resyncs by sequence, never by refetching on a guess.
6. **The client owns the uncontested.** Rosters, needs, tiers, the must-pick rule and the manager's own sheet derive from the log with the same core code the server runs. Only the pick itself needs the server.

## 3. Repository layout

One pnpm workspace. Node 22. Vitest, Playwright, ESLint strict, `tsc --noEmit` at the root.

| Package | Holds | Moves from |
|---|---|---|
| `packages/core` | The research core and every service that is pure TypeScript over a `Db`: projections, draft engine (with `replay-pins.fixture.ts`), draft and mock-draft services, the advisor and simulator (`src/draft-service/assistant`, `sim`), capsules, integrity rules and copy rules, league, money, payments-provider seams, stats pipeline, scoring, chat and review services, matchmaking, `lib/llm`, `lib/random`, `lib/cache`. Tests move with their modules. | `src/projections`, `src/draft-engine`, `src/draft-service`, `src/mock-draft*`, `src/capsules`, `src/integrity`, `src/league-service`, `src/money`, `src/money-service`, `src/payments-provider`, `src/stats-pipeline`, `src/scoring`, `src/domain`, `src/identity-service`, `src/trades`, `src/matchmaking`, `src/lib/{llm,random,cache}`, `src/coaches`, `src/data` |
| `packages/db` | `schema.ts` (3,621 lines, kept), the Drizzle client, one baseline migration squashed from `drizzle/0000` to `0088`, the four test lanes (`src/db/test-lanes.ts`). | `src/db`, `drizzle/` |
| `packages/design` | `tokens.ts`, `generate-css.ts` emitting `--commish-*` CSS variables, `motion.ts`, the source guards re-pointed at `.svelte`, and the Svelte primitives rebuilt from the mocks. The 71 exports of `src/components/ui/index.ts` are the inventory to rebuild, not code to port. | `src/design`, `src/components/ui` (inventory only) |
| `apps/web` | SvelteKit routes and server endpoints, the socket server, the room owner, the job worker, the simulation thread pool, the process entry. | Replaces `src/app`, `src/lib/realtime`, `src/event-stream`, `src/jobs` (runner, tick, self-wake, cron), `src/draft-room` (React), `src/*-room` (React), `src/instrumentation.ts`, `src/middleware.ts` |
| `infra` | `app.yaml` (App Platform spec), `otel-collector.yaml`, `docker-compose.yml` for local Postgres and Valkey. | `docker-compose.yml`, `vercel.json` (deleted) |

What dies: Next.js and React, Vercel, Neon, the owned job system's runner and self-wake (`src/jobs/self-wake.ts`, `run-handler.ts`, `tick-handler.ts`, `wake.ts`), `draft-advance-job.ts`, `draft-sweep-job.ts`, `pacing.ts`, `ticker.ts`, SSE (`src/lib/realtime/sse.ts`), the Redis facts store (`facts-store.ts` keeps only `serializeRoomFacts` and its wire form), `after-response.ts`. The job step bodies (`capsule-sweep`, `capture-harvest`, `season-week`, `adp-snapshot`, `props-preseason-snapshot`, `win-totals`, `draft-grades`, `peek-document`) move to `apps/web/src/server/jobs` on the new contract with their tests.

The pure client state under `src/draft-room/state` (`apply-event.ts`, `optimistic.ts`, `queue.ts`, `roster-fill.ts`) moves into `packages/core/draft-client` because it is the derivation both sides share.

## 4. The process

`apps/web/src/server/main.ts`, in order:

1. **Env.** Parse every variable with zod and fail fast. `DATABASE_URL` (pooled), `DATABASE_DIRECT_URL` (for LISTEN), `VALKEY_URL`, `WORKOS_*`, `ANTHROPIC_API_KEY`, `ROOM_TICKET_SECRET`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `INSTANCE_ID` (App Platform's).
2. **OpenTelemetry.** The Node SDK starts before any import that opens a socket.
3. **Postgres.** One pooled `postgres` client for requests, one direct connection for graphile-worker's LISTEN.
4. **Reference data.** Players, teams, schedule, byes and the served board load into memory (section 9).
5. **The HTTP server.** `http.createServer` mounts SvelteKit's `adapter-node` handler. `/healthz` answers liveness. `/readyz` answers readiness and turns false on drain.
6. **The socket server.** `ws` attached on `upgrade` for `/ws` only. Everything else upgrades to nothing.
7. **The worker.** graphile-worker's runner starts with concurrency 4, sharing the pool.
8. **The room registry.** Adopts rooms (section 5) and re-arms timers from the lease table.
9. **The simulation pool.** `worker_threads`, cores minus one, at least one. Each thread loads core once and answers `{ state, seed, runs }` with the odds table. Same seeding as today (`seedFor(draftId, sequence)`, `service.ts:93`, `ADVISOR_CONFIG.runs` = 200).

**Graceful drain.** On SIGTERM: `/readyz` false, stop adopting, finish in-flight actions, release every lease (`expires_at = now()`), close sockets with code 1012 so clients reconnect at once, stop the worker, end the pools. Budget 25 s inside App Platform's termination grace. The other instance adopts within one renewal period.

**Why one process.** Every failure in section 1 was a handoff between processes that shared nothing. The pick, the timer, the facts compute and the frame now share a heap. Worker threads exist only because the simulation is 250 ms of CPU per pick (`assistant/config.ts:15`) and timers must stay within milliseconds.

## 5. Rooms

**Lifecycle.** `scheduled` arms a start timer at `mock_rooms.starts_at` or `drafts.kickoff_at`. `in_progress` arms one timer at the earlier of the on-clock bot's seeded due instant and the deadline. `complete` releases the lease and keeps sockets open 60 s. `dissolved` (money dissolution, `drafts.status`) closes at once.

**The lease.** Table `draft_room_leases` as the interim design wrote it (draft id, owner, generation, acquired, renewed, expires) plus `instance_id` and `next_due_at`. Acquire is an upsert guarded by `expires_at < now()` returning the generation. Renew is guarded by owner and generation. Zero rows on renew means the lease is lost and the room drops its timer at once. Every write the owner makes carries its generation and the store refuses a stale one. Correctness never rests on the lease. The store's `drafts FOR UPDATE`, the in-lock replay against `MAX(sequence)`, `admitCommand` and the unique index (`store.ts:487` and around) still serialize every writer. The lease only prevents duplicate timers.

**Durable time.** When the owner arms a timer it writes `next_due_at` on the lease and upserts one graphile job keyed `room:<id>` with `run_at = next_due_at + 5 s`. If the owner acts on time, the job finds the sequence advanced and exits. If the owner is dead, the job's instance adopts the room and acts. On restart every instance reads the leases it owned and re-arms. The minute-level safety scan only finds rooms with no lease and no job. Reads never advance state.

**Replay on takeover.** A new owner holds nothing but the log. `replayDraft` (`draft-engine/replay.ts`) rebuilds state, the bot streams re-derive from the seeded RNG (`driver.ts:291`, `rngFor(meta.botSeed, botDelayStreamKey(teamId, pickNumber))`), and the next due instant is byte-identical. The replay pins pass unchanged.

**Clock and pacing.** `DRAFT_CLOCK_SCHEDULE` (8h, 4h, 1h, 10m, 90s) and the 2 to 5 AM Eastern pause stay in the selectors (`pause.ts` is never imported by the reducer). Bot delay comes from the START_DRAFT snapshot. The 300 ms wire floor (`minPickSpacingMs`) moves to timer arming, stamps untouched. Autopick and skip stay the reducer's on `TIMER_EXPIRE`.

**Sharding.** Launch runs two instances. Room ownership is first-claim. The App Platform load balancer does not route by room, so any instance may hold a viewer's socket. A socket on a non-owner subscribes to the room's Valkey channel `room:<id>` and relays. The owner publishes each frame to its local sockets and to that channel. A human action arrives over the socket at whichever instance, is applied through the store's lock path, and the owner observes the new sequence on the channel and re-arms. Rooms never move while a lease is live. A third instance is a number in `app.yaml`. This is designed now and exercised on staging in phase two so the first September needs no design.

**Facts.** After every accepted action the owner posts the state to the simulation pool and sends a `facts` frame at that sequence. `serializeRoomFacts` keeps its wire form. Viewers never compute odds.

## 6. The socket contract

**Connect.** The client opens `wss://<host>/ws` with the AuthKit cookie. The first client frame is `hello { ticket, since }`. The ticket is minted by `POST /api/rooms/:id/ticket` after the membership check (`draft-service/authz.ts`), format `v1.<base64url payload>.<hmac-sha256>` over `{ roomId, leagueId, userId, teamId, exp }`, TTL 12 h, verified with `timingSafeEqual` under `ROOM_TICKET_SECRET`. It rides in a frame, not the URL, so it is never logged. Origin is checked on upgrade.

| Frame | Direction | Payload |
|---|---|---|
| `hello` | client | ticket, last sequence seen |
| `welcome` | server | sequence, generation, presence, the latest facts, or `snapshot` when the gap exceeds the ring |
| `pick`, `nominate`, `bid`, `timer_expire`, `status`, `queue` | server | the log entry, `clock.sequence` inside, as `payloads.ts` schemas them today |
| `act` | client | a `ClientDraftAction` with a client id for optimistic matching |
| `ack` / `refused` | server | client id, sequence or the refusal sentence |
| `resync` | server | draft id, the client refetches the snapshot |
| `facts` | server | sequence, computed at, the odds wire form |
| `presence` | server | user ids present, coalesced |
| `reaction`, `chat`, `typing` | both | as `chat.*` and `stream.reaction` today, typing never persisted |
| `lineup`, `claim`, `trade`, `score` | server | Sunday and the wire, one shape per event, all carrying the league's event id |

**Backpressure.** Each socket's `bufferedAmount` is read before a send. Over 64 KB, `typing` and `presence` are dropped and picks still go. Over 1 MB the socket closes with 1013 and the client reconnects with `since`. Presence and typing coalesce to one frame per 250 ms per room.

**Reconnect.** The owner keeps a ring of the last 512 frames per room. `hello.since` inside the ring answers with the delta. Outside it answers `snapshot`. The client backs off 250 ms to 5 s and never gives up. Three refused reconnects trigger a snapshot fetch over HTTP, then a reopen.

**Hidden tabs.** A hidden tab stops sending presence and closes its socket after five minutes. The server marks a member away after 60 s without presence. Return reopens with `since`.

## 7. Client architecture

Svelte 5 runes. `room.svelte.ts` holds the config and the log as `$state`. Rosters, needs, tiers, the must-pick rule and the sheet view are `$derived` through core's selectors (`selectors.ts`, `roster-need.ts`, `assistant/tiers.ts`), the same functions the owner runs. Own actions apply an optimistic patch (the `optimistic.ts` rule: display only, never a slot, a round or a turn) and roll back on `refused`. Sheets are local-first: IndexedDB is the write path, `draft_sheets` syncs behind it, and a sheet edit never waits on the network.

The fluidity gates carry over from the draft-room ruling (first principles, section 7, ruling 4): every surface except the odds settles within 250 ms at p90 of the pick frame, zero long tasks across a 180-pick draft, receipt-to-cell under one frame at p90, virtualized columns, rows keyed by player id, no stacked animations. Motion follows `motion.ts` and P4.

The odds figure settles when the `facts` frame lands. Its number is the pick-to-facts trace, reported, not hidden.

## 8. Data and jobs

**graphile-worker, not pg-boss.** Both are Postgres-backed. graphile-worker wakes on LISTEN within milliseconds, which the room reconcile job needs, and `job_key` with `replace` gives an idempotent re-arm per room. pg-boss polls on an interval and holds its own schema. graphile's cron file carries the schedules that live in `schedules.ts` today: season-week Tuesday 08:00, Wednesday 18:00, Thursday 14:00 ET, harvest hourly, capsule sweep 04:00 ET, win totals Wednesday 05:00. The cost is one direct connection per instance for LISTEN, which the built-in pooler does not carry.

**Ingestion during game windows.** A `stats-live` job runs every minute from the first kickoff to the last final of each slate when `STATS_INGESTION_MODE=live` (`stats-pipeline/config.ts`, about 250 extra requests a Sunday on top of the schedule calls). It publishes `score` frames through the league channel.

**Season as a dimension.** The data tables already carry `season` (`player_week_observations`, `preseason_rosters` and the rest). `leagues` and `drafts` do not: `leagues` carries only `season_completed_at` (`schema.ts:300`). The baseline adds `season integer not null` to `leagues`, `drafts`, `matchups`, `draft_sheets` and `adp_snapshots`, backfilled at cutover, so a league record spans years and 2026 stays the held-out year.

**Retention.** Mock rooms follow `MOCK_CONFIG.retention` (24 h complete, 2 h unstarted). Ended leagues are kept: records and rivalries are the return hook (P9). **Account deletion** is new (no writer exists under `src/identity-service` or `src/account-room`): a 30-day grace, then the user row is anonymized to a tombstone id, league events keep the tombstone as actor because the audit chain is append-only, and money entries survive for the tax record.

## 9. Caching

`apps/web/src/server/cache.ts`, one module, every entry named with its invalidation:

| Entry | Where | Invalidated by |
|---|---|---|
| Room state, log ring, facts | in-process, owner only | the next action, lease release |
| Rendered board per format and season | in-process | the nightly capsule sweep and `preseason-persist` |
| Rendered player page per player and format | in-process | the same sweep, the harvest for that player |
| Reference data (players, teams, schedule, byes) | in-process at startup | its ingest job, which publishes `ref.reload` on Valkey |
| Static assets, front door, league rules, legal | HTTP `Cache-Control`, immutable hashes | the deploy |
| Rate limits, reaction budget | Valkey | window expiry |
| Room fan-out, presence, `ref.reload` | Valkey pub/sub | none, it is transport |

Valkey is never a scheduler, a lock or a source of truth. A Valkey outage degrades a second instance's relays and rate limits, not a room.

## 10. Money and premium

**The wallet ships at launch.** The ledger is the one already built: `money_accounts`, `money_transactions`, `money_entries` (append-only by trigger, balanced sets through `postMoneyTransaction`, `state_of_entry` and `tax_year` on every row). The eight account kinds and twelve posting kinds in `docs/money.md` stand. Escrow is `league_escrow:<leagueId>`, credited the full fee at join. Payouts are `settlement` from the stored prize table, rake swept per seat. Refunds on a folded league are `dissolution`, escrow to exactly zero. The baseline adds `season` to `money_transactions`.

**What changes.** Reconciliation becomes a daily job (`money-reconcile` at 06:00 ET) writing a `money_reconciliations` row and raising an alert on drift, in place of the level-triggered script. Commissioner-initiated dissolution (D2) ships pre-draft only. The money-live checklist in `docs/money.md` is phase four's task list.

**Open: the provider.** Founder decisions named Column for the FBO account and Aeropay plus Paysafe for rails, unsigned. That question is open and stays with the founder. The seam (`payments-provider/contract-suite.ts`, ACH return case included) is what any answer must pass.

**Legal questions the founder must answer**, from `2026-09-07-premium-research-tier-legal-questions.md`: entry states and licensing, UIGEA fit of the house factory's fixed pots, neutrality language in the terms, auto-renewal rules, fee disclosure placement, bundling, age and identity checks, escrow handling and tax thresholds, advertising limits, disclosure for model-written analysis.

**The premium research tier ships at launch.** Rule: information only, never a mechanic. A subscriber and a free manager see the same room, the same pot, the same clock, the same advisor. A `subscriptions` table carries the entitlement. Its billing processor is a separate question from the wallet's rails (`money-foundations.md` D9 says SaaS billing is a different merchant category). Surfaces, each labeled research with its basis:

- The full board in every format with tiers, receipts and the held-out record, beyond the free top of each position.
- The player page's written analysis, the peek document and multi-season history.
- The simulator at 1,000 and 10,000 runs (`SIM_RUN_OPTIONS`), free at 100.
- The weekly lineup dossier and the trade read.
- Rankings export.

A guard test asserts that no premium-gated path imports a contest writer (rosters, waivers, drafts, payouts, matchups).

## 11. Observability

The OpenTelemetry Node SDK in the app with auto-instrumentation for http, pg and ws, plus manual spans for `room.action`, `room.timer` (with `lateMs`), `room.facts`, `socket.send` and `job.run`. Export by OTLP to `otel-collector`, an internal App Platform service component, which batches to Grafana Cloud. Resource attributes: `service.name`, `service.version` (the git sha), `deployment.environment`, `service.instance.id`. Sampling: head sampling at 10 percent for HTTP spans, 100 percent for room spans, jobs and errors. Logs are JSON lines through the same exporter.

Dashboards: rooms (owned, viewers, timer lateness, pick arrival), jobs (queue depth, failures, run time), sockets (open, buffered, closes by code), Postgres (pool wait, slow queries), the client vitals.

Three launch alerts: a room without an owner over 10 s, a job failed twice, pick arrival p90 over 150 ms.

The client vitals probe posts LCP, INP, CLS and the room's receipt-to-paint to `/api/vitals`, sampled at 10 percent, and lands on the same dashboard.

## 12. Security and privacy

Secrets live in App Platform encrypted env, never in the repo. `ROOM_TICKET_SECRET` rotates with a two-key window. The ticket is short-lived, membership-checked at mint, in a frame not a URL. Rate limits move from the in-process fixed window (`lib/api/rate-limit.ts`, "resets when the process does") to Valkey sliding windows per user and route, plus the reaction budget. Backups: Managed Postgres PITR at seven days, and a weekly job restores the latest backup into the staging database and runs a row-count and chain-verify check (`verify-audit-chain.ts`). A backup that has not been restored is not a backup. The privacy and terms pages carry over (`src/app/legal/privacy`, `terms`) and go to counsel with the section 10 questions. WorkOS AuthKit stays behind `getCurrentUser()` (`lib/auth/current-user.ts`), reimplemented over `@workos-inc/node` for SvelteKit's `hooks.server.ts`.

## 13. Deployment and environments

`infra/app.yaml` declares one app: `web` (service, two instances, `/readyz` health check, port 3000, WebSocket enabled), `otel-collector` (internal service), `migrate` (pre-deploy job running `drizzle-kit migrate` against the baseline), Managed Postgres (PITR on, pooler in transaction mode for `DATABASE_URL`, direct for `DATABASE_DIRECT_URL`), Managed Valkey. Region NYC3. The staging app is the same spec from the `staging` branch with a small database and one instance.

Deploys are rolling: the new instance passes `/readyz`, the old one gets SIGTERM and drains (section 4). A draft in progress sees one reconnect and no lost pick.

**Cutover night from Neon.** Rehearsed twice on staging with a production dump. The night: announce a window, set the old app read-only, `pg_dump` from Neon, restore to Managed Postgres, run the baseline's backfills, verify counts and the audit chain, point DNS at the App Platform host. Rollback is DNS back to Vercel. Neon and Vercel stay up seven days. Then decommission.

## 14. Phases

Each phase runs the loop (plan, build, review, merge to main) and ends at a gate the founder sees.

| Phase | Weeks | Delivers | Exit gate | Founder decides |
|---|---|---|---|---|
| 1 Infra and skeleton | 2 | The monorepo, core lifted with tests green, baseline migration, the process with handler, sockets and worker, App Platform app and staging, collector to Grafana, WorkOS sign-in | Sign in on staging, a socket echo, a job run, a trace in Grafana | Approves the DigitalOcean bill and the instance size |
| 2 Draft room | 4 | Rooms, lease, sharding on two instances, the socket contract, the Svelte room from `draft-room.html` and `draft-room-your-sheet.html`, facts in the pool, mock lobby from `draft-area-mock.html` | Pick-arrival trace p90 under 150 ms on staging across a 180-pick solo mock, no two picks within 300 ms, an unwatched room completing on time, the fluidity gates, takeover under 10 s with a killed instance | Approves the room against the mocks |
| 3 League home, board, player page, front door, signed-in home | 4 | Each from its mock (`front-door.html`, `player-page.html`, `draft-area-board.html`, `draft-area-sheet.html`, `signed-in-home.html`), cached per section 9 | Persona walk per surface, guards green on `.svelte`, board and player page under 200 ms server time warm | Approves each surface from the screen |
| 4 Team, Sunday, wire, account, admin, house factory, wallet, premium | 3 | Lineups, live scoring frames, waivers and trades on the socket, account with deletion, admin room, house factory, wallet on the ledger, subscriptions and the premium surfaces | A Sunday replay from recorded 2026 stats moves scores live, money dark-state spec passes, premium guard test green | Names the provider, the launch states and the subscription price, or defers them past launch |
| 5 Data jobs, cutover, decommission | 2 | Every job on graphile, two rehearsals, the night, seven days of watch, Vercel and Neon closed | Zero data loss on counts and chain, alerts quiet for seven days | Picks the night |

Fifteen weeks. Starting the first week of October puts parity in mid January 2027.

## Testing during the rebuild (founder rulings, 2026-09-19)

No new tests are written during the rebuild, and no test suite runs during a build phase, not even the salvaged core's. Per round the gates are `tsc`, the source guards (copy rules, honest numbers, the client boundary sweep, each under a second), and the measurement trace for the surface: pick arrival, per-surface settle, a socket open across a whole draft. Surfaces are built to their approved mock, walked by the persona panel, and reviewed by reading the code. The full suite, including the replay pins, runs once at cutover as the acceptance of the whole, and the app's own suite is written as its own phase after that. Any round brief for this rebuild that says "tests first" or "run vitest" is wrong and this section wins.

## 15. Risks

- **The desktop draft board.** The Sideline wall-plus-stream split is unproven at width. Phase two builds it first and the founder uses it before anything else is trusted.
- **Simulation CPU.** 250 ms per pick per room bounds rooms per instance. Phase two measures one, two and four concurrent rooms and sets the instance size.
- **LISTEN through the pooler.** graphile-worker needs a direct connection. If the managed pooler cannot pass one, the worker falls back to 500 ms polling, stated in the phase-one gate.
- **Svelte 5 depth.** The team's depth is React. The primitives are rebuilt, not ported, and phase one includes a spike of the room's wall to find the runes model early.
- **Money legality.** The wallet ships dark until the founder names states with counsel. The code path exists, the switch stays off.
- **Cutover data volume.** A dump and restore of the data tables may exceed a window. Rehearsal one measures it. Logical replication is the fallback.

## 16. Deferred

Native mobile (the phone is the web app at 720 first). Go for a proven hotspot (none is measured yet, and the simulation's pool is the first lever). A second region. Auction drafts in the new room (the engine keeps `auction.ts`, the surface waits). Percent-of-pool rake, peer-to-peer transfer and anything on the money refusal list stay refused.

## 17. Phase one tasks, ordered, for the writing-plans skill

1. **Workspace.** `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, ESLint strict, Vitest workspace, `.nvmrc` at 22. Files: the root, `packages/*/package.json`, `apps/web/package.json`.
2. **packages/db.** Move `src/db/**`. Squash `drizzle/0000` to `0088` into `packages/db/migrations/0000_baseline.sql` by dumping a migrated dev schema, plus the season columns of section 8. Keep `test-lanes.ts`. Tests: `schema.test.ts`, `audit-append-only.test.ts` and the lane tests green.
3. **packages/core.** Move every directory in section 3's core row with `@/` rewritten to `@commish/core/*`. Delete the Next imports (`after-response.ts`, `api-routes.test.ts`'s route glue). Gate: every moved test green, `replay-pins.fixture.ts` byte-identical.
4. **packages/design.** Move `tokens.ts`, `generate-css.ts`, `motion.ts`. Re-point `sourceFilesIn` (`design/test-support.ts:91`) and the integrity copy guards at `.svelte` and `.ts`. Emit `tokens.css`. Files: `packages/design/src/*`, the fifteen `*.source.test.ts` guards under `src/design` and `src/integrity`.
5. **The process.** `apps/web/src/server/main.ts`, `env.ts`, `http.ts`, `sockets.ts` (upgrade, `hello`, echo), `worker.ts` (graphile runner, one `noop` job), `drain.ts`, `health.ts`. Tests with an injected clock and an in-memory socket pair.
6. **SvelteKit shell.** `svelte.config.js` with `adapter-node`, `hooks.server.ts` with `getCurrentUser()` over `@workos-inc/node`, `/sign-in`, `/callback`, `/sign-out`, a signed-in home stub that phase three replaces. Files under `apps/web/src/routes`.
7. **Ticket.** `apps/web/src/server/ticket.ts` (mint, verify, rotation window), `POST /api/rooms/[id]/ticket`, tests including a tampered ticket and an expired one.
8. **Observability.** `apps/web/src/server/otel.ts`, `infra/otel-collector.yaml`, the resource attributes, one manual span, the three alert rules as Grafana provisioning files under `infra/grafana/`.
9. **Infra.** `infra/app.yaml` (web, collector, migrate job, Postgres, Valkey, staging from branch), `infra/docker-compose.yml`, `apps/web/Dockerfile`. First staging deploy.
10. **Spike.** A Svelte 5 wall of seven columns by fifty rows fed by a replayed log at 700 ms per pick, measured for long tasks and receipt-to-cell. Files: `apps/web/src/routes/dev/wall`. Result recorded in the plan's ledger.
11. **Gate.** Sign in on staging, a socket echo, a job run, a trace in Grafana, the spike's numbers. Founder review.
