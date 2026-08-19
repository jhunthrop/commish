# Decision: the live-scoring pipeline

**Date:** 2026-08-19 · **Phase 2, Plan B** · Spec: `plans/phase-2-accounts-and-data-foundation.md` Step 7

## What this document is for

The spec's own bar for it: specific enough that swapping `MockStatsProvider` for a real vendor
adapter later requires no change to the worker, index, or cache logic. Everything below is
written to that bar — it says what the seam guarantees, why each shape was chosen over the
obvious alternative, and closes with the one section that states the actual claim: what a real
vendor swap does *not* touch.

## 1. The request-cost contract

`StatsProvider` (`src/stats/provider.ts`) carries its cost in its own docblock, because the whole
ingestion cadence is built on it:

| method                    | upstream requests                                |
|---------------------------|---------------------------------------------------|
| `listPlayers()`           | 2, memoized for the life of the provider instance  |
| `listGames(week)`         | 1                                                   |
| `getGameStatLines(game)`  | 1                                                   |
| `getWeeklyStatLines(week)`| 1 + one per game in the week                        |

The unit of work is a **game**, not a week, because the unit of *cost* is a game. A
`getWeekSnapshot(week)`-shaped method would hide the request count from the caller entirely — the
worker would have no way to say "fetch everything except these fourteen games I already have,"
which is exactly the ability that turns a naive full-Sunday poll into a budget the free tier can
afford (see §2). `getGameStatLines(game)` gives the worker a per-game decision point;
`needsBoxScore` (`src/stats-pipeline/worker.ts`) is where that decision actually gets made, once
per game per tick, against the Redis `finalGame` marker.

`getWeeklyStatLines` stays on the interface as a **composition of the other two**, not a second
implementation of "this week's stats." It is the shared contract suite's anti-drift device
(`describeStatsProviderContract`, `src/stats/test-support.ts` asserts the per-game reads sum to
exactly the same lines the week-level read returns), which is the cheapest way to keep two things
agreeing forever: make one of them *be* the other. `seedPlayers` used to walk weeks with it and now
reads per game like the worker does, for a budget reason rather than a correctness one — see §2.

The interface also carries `lastWeekOfSeason`, a value and not a method, because it costs no request
and every provider knows it. It is where the worker's week pointer stops (§2).

## 2. The budget arithmetic

This is the section a founder reads before buying a tier. `STATS_INGESTION_CONFIG`
(`src/stats-pipeline/config.ts`) carries the arithmetic in its own docblock and
`src/stats-pipeline/config.test.ts` asserts it in literal numbers, so it cannot drift from the
tunables it is derived from.

The numbers below are the LEDGER's numbers: what `RequestBudget.reserve()` debits, which since the
two-phase reservation landed is exactly what the tick spends upstream. A month is 31 days of
uninterrupted ticking, because the worker runs on a timer and not on an NFL calendar — the earlier
version of this table counted a Sunday's polling and then compared it against a monthly ceiling,
which is the arithmetic error that made the shipped configuration unrunnable.

| Line item | Arithmetic | Requests per month |
|---|---|---|
| Ticks per month | 86,400,000 / 1,800,000 x 31 days | 1,488 ticks |
| Schedule calls, steady state (one examined week) | 1 x 1,488 | 1,488 |
| Schedule calls, the second week on a rollover tick | 1 x 5 week rollovers | 5 |
| Box scores, `final-only` (each fetched once, ever) | 16 games x 5 weeks | 80 |
| The correction sweep (§10) | (1 schedule + 16 box scores) x 3 days x 5 weeks | 255 |
| A sweep cut short by a live week, retried next tick | 1 schedule x 3 days x 5 weeks | 15 |
| **Ingestion total** | | **1,843** |
| The season backfill (`npm run seed`) | 2 + 18 x (1 + 16) | 308 |
| **Everything** | | **2,151** |

The rollover line is ONE tick, not a tail: the tick that resumes at a week with no `stat_weeks` row
examines two weeks and plants both rows, so the tick after it is narrow again. Five a month is an
upper bound — in continuous operation the lookahead row is already there about half the time.

The line that is deliberately absent is a wedged week's widened window, and its absence is the
premise the whole table rests on. `wedgedWeekTicks` is 384: eight days at the shipped cadence,
against the ~336 ticks a week is legitimately un-advanceable for (it becomes the earliest non-final
week the moment the previous week settles and stays that way until its own last game ends). A
threshold below that makes the WIDENED window the steady state for most of the season and puts the
real figure at ~4,800 against a 2,692 ceiling (a wedged window is three schedule calls per tick,
the wedged week plus the two forward weeks) — over by enough to go dark before mid-month. `config.test.ts` asserts `wedgedWeekTicks > ticksPerDay * 7`, and asserts that a permanently
widened window would NOT fit, so the tunable and the projection cannot drift apart again.

`monthlyRequestBudget` therefore defaults to **3,000**, not 1,000: a 24/7 worker at a thirty-minute
cadence spends 1,488 requests on schedule calls alone, more than a 1,000-request tier's whole
ingestion share, before a single box score. That is a ceiling on what THIS deployment is allowed to
spend, not a claim about the purchased quota — `STATS_MONTHLY_REQUEST_BUDGET` must be set to the
quota actually bought, and if that number is smaller the ledger will start denying partway through
the month, which is the correct and visible failure.

**Why one examined week and not two.** `maxWeeksPerTick` is still 2, but the window only widens to
it when the earliest non-final week has no `stat_weeks` row yet (a cold start, or the first tick
after a week rolls over) or when that week has wedged (§11). Otherwise the week after the current
one is entirely `scheduled` games that cannot have moved, and re-listing it every thirty minutes
for a week straight was the single largest line in this table for no information at all. Nothing
depends on the lookahead planting a row: `examinationWindow`'s third case resumes at `MAX(week) + 1`
once every existing row is final, which is what advances the pointer.

**Who the ledger counts.** Only a provider that actually spends money. `StatsProvider.requestCost`
is `metered` for Tank01 and `free` for the mock, and the edge (`src/stats-pipeline/index.ts`) hands
that through to `createRequestBudget`. A free provider answers out of a committed JSON file and
never reaches a network, so counting its calls spends a ceiling that exists to protect an API key
against requests no key ever sees — which used to mean ten `npm run seed` runs in a month silently
stopped a developer's own worker from ticking.

**Where the pointer stops.** `StatsProvider.lastWeekOfSeason` — the provider's own number, not this
module's. Tank01's regular season runs to week 18 and the committed mock dataset is 17 weeks; a
pipeline constant of 18 left the pointer asking the default provider for a week it can never answer,
`tickWeek` returned before writing a row, the pointer never advanced, and every tick paid for the
same empty listing forever.

**Two-phase reservation.** The tick reserves what it is about to spend, twice, and never a worst
case: `weeks.length` before the `listGames` calls, then — once the schedules are in hand and the
mode, the `finalGame` markers and `maxGamesPerTick` have decided exactly which box scores this tick
will fetch — that exact count. There is deliberately no release path: a release is a second round
trip that can be lost, and a lost release is a permanently over-counted ledger. The earlier shape
reserved `weeks.length + maxGamesPerTick` up front with no release, so 850 requests bought 38 ticks
and the ledger went dead about nineteen hours into every month. A denial at phase two skips the
fetches and keeps the schedules, which are already paid for; the week's honest game counts are still
persisted, and `everyFinalGameIngested` is what stops that from marking a week final early.

**Where this stands today:** a paid Tank01 tier is approved and the key already lives in
`.env.local`. `live` mode is the launch target — `final-only` is cheap, but a manager watching a
score move only at the final whistle is not the product — and flipping `STATS_INGESTION_MODE=live`
is the whole rollout, now that the variable is actually read (`resolveIngestionSettings`,
`src/stats-pipeline/settings.ts`). It is not a free flip: live mode fetches every non-final game
every tick, roughly 900 requests a month on top of the schedule calls, so
`STATS_MONTHLY_REQUEST_BUDGET` moves with it.

`STATS_INGESTION_CONFIG.reservedForBackfill` (308 of the 3,000) is held out of the ingestion budget
`RequestBudget.reserve()` draws against, so a live season's polling can never starve `npm run seed`.
It is a real reservation and not merely a smaller ingestion ceiling, because `seedPlayers` now
reserves through `RequestBudget.reserveBackfill` — against the FULL monthly quota — at the exact
cost of each call it makes: 2 for `listPlayers`, then per week one `listGames` and one box score per
game. It reads per game rather than through `getWeeklyStatLines` for exactly that reason: listing
the week first makes its cost knowable before a single box score is fetched. The contract suite
asserts the two reads return identical lines, so the seeded rows are unchanged.

## 3. The unrecognized-status ruling

`GameStatus` is `"scheduled" | "in_progress" | "final"`. An upstream spelling this codebase does
not recognize maps to `in_progress` — never to `final`, never to `scheduled` — and the reasoning
is asymmetric, not a coin flip between three options:

- Mapping to `final` means the game is never fetched again (`needsBoxScore` only re-fetches a
  `final` game the first time it's seen so) and its points are lost for the season, permanently.
- Mapping to `scheduled` means the game is never fetched at all (`needsBoxScore` returns `false`
  for `scheduled`) and the lineup lock (`isLineupLocked`) never engages for it.
- Mapping to `in_progress` costs exactly one extra request per tick — a `listGames` call already
  happening anyway asks about it again next time — and is correct the instant either the spelling
  is recognized or the game actually ends.

`in_progress` is the only one of the three that is self-correcting. `map.test.ts`'s "maps an
unrecognized, missing or absent gameStatus to in_progress, the safe default" (`src/stats/tank01/map.test.ts`)
carries an invented status spelling through `mapGames` and asserts the mapping lands on
`in_progress`, which is what proves the ruling rather than a comment merely asserting it.

## 4. The delta diff and the snapshot key

Every tick, for every week it examines, the worker fetches whatever box scores its budget allows
and diffs the result against the *previous* tick's fingerprint of that week, stored at
`STATS_INGESTION_CONFIG.keys.snapshot(week)` (`stats:snapshot:${week}`, a Redis hash keyed by
`playerId`).

`statLineDigest` (`src/stats-pipeline/digest.ts`) is a plain `|`-joined string of every
`STAT_FIELDS` value on a line, in field order — not a hash. A join changes if and only if a
number changes, is directly readable in `redis-cli` when debugging a tick that looked wrong, and
buys nothing over a hash for a fixed 14-field line. `diffStatLines` compares the incoming lines'
digests against the stored snapshot and returns only the lines whose digest moved; a player with
no prior digest (never seen this week, or newly active) counts as changed unconditionally, since
there is no "unchanged" to compare against.

The digest map `diffStatLines` returns carries **every** incoming line's digest, changed or not —
not only the changed ones. That full map is what the worker writes back as the next tick's
snapshot (`redis.hset(snapshotKey, ...)`). Writing back only the changed subset would drop every
untouched player from the snapshot and make all of them look changed on the following tick, which
is the same bug as having no diff at all.

## 5. The affected-roster resolver

`affectedTeams` (`src/stats-pipeline/affected.ts`) answers "which teams' scores can this week's
changed players move" with two Postgres index lookups, not a maintained Redis map:
`lineup_slots_player_week_idx` on `(player_id, week_number)` and `roster_slots_player_idx` on
`(player_id)` (both migration `0013`). Postgres maintains both incrementally, inside the same
transaction as the lineup save or the draft pick that changed them — there is no invalidation
code to forget and no drift to detect, which is what a hand-rolled Redis map would be trying to
imitate and could get wrong in a way whose symptom is a manager's score silently not updating,
the worst kind of bug to discover in week 12. `src/db/index-plans.test.ts` fails the build if
either plan ever sequentially scans, so the "index lookup" claim is enforced, not just believed.

Both halves are needed because `getLineup` (`src/league-service/lineups.ts`) has two halves:
saved `lineup_slots` rows win when they exist, and a team with **none** saved for the week fields
its roster via `defaultLineup`. `affectedTeams` mirrors that exactly:

- The **started** half joins `lineup_slots` for the week, excluding the bench slot, for every
  changed player — this is every team that explicitly named a changed player as a starter.
- The **owned** half joins `rosterSlots` for every changed player, but only for teams with **no**
  `lineup_slots` row for that week at all (a `NOT EXISTS` subquery) — this is every team that
  never opened the lineup editor and is quietly running its drafted roster.

Restricting the roster half to teams with nothing saved is what stops a deliberate benching from
being undone: a team that explicitly benched a player has a `lineup_slots` row (even if the
player named in it sits on the bench), so it fails the `NOT EXISTS` check and is correctly
excluded from the roster half — only the started half can surface it, and it won't, because the
player isn't in a starting slot.

## 6. The cache-key scheme

`ScoreCache` (`src/stats-pipeline/score-cache.ts`) is one Redis key per `(leagueId, week)`
(`STATS_INGESTION_CONFIG.keys.score`), and the freshness signal — `stat_weeks.version` — lives in
the **value**, not the key: `{ version, scores }`, JSON-encoded. A read compares the stored
version against the version the caller considers fresh and discards the value on any mismatch.

The alternative — folding the version into the key itself — was rejected because it makes
lineup-triggered invalidation either a `SCAN` over a key pattern (slow, and a pattern scan on a
shared Redis is antisocial to every other tenant of that instance) or a bet that the invalidating
write knows every version that has ever been written for that league/week, which it cannot in
general. With the version in the value, a lineup write (`setLineup`, via its injected
`ScoreCache.invalidate`) is a single `DEL` of a key it can name exactly, no pattern and no
enumeration required. The cost of this choice is one wasted read per stale entry between a
version bump and the next write — bounded by the key's own TTL
(`STATS_INGESTION_CONFIG.ttlSeconds.score`, seven days), which is cheap insurance against a
correctness bug that a key-encoded version would risk instead.

## 7. The two degradation directions

`ScoreCache` and `RequestBudget` fail in opposite directions on purpose, and each module's own
docblock names the other so the asymmetry reads as a decision rather than an oversight:

- **The score cache fails OPEN.** Every method (`read`, `readMany`, `write`, `invalidate`)
  catches its own Redis error and returns a miss/no-op rather than throwing. A missed cache read
  costs milliseconds and the page still renders the correct answer from Postgres — Phase 1's
  standing rule that Postgres is authoritative and Redis is an accelerator.
- **The request budget fails CLOSED.** `reserve()` returns `false` on any Redis error, denying
  the reservation rather than guessing it would have succeeded. A miscounted request budget risks
  the upstream API key itself; a suspended key does not come back in five minutes the way a slow
  page does.

The asymmetry is between "slower" and "unrecoverable," not an inconsistency: a module that can
only make the product slower is allowed to guess in the user's favor, and a module that can get
an account suspended is not allowed to guess at all. `RequestBudget.reserve()` also runs as a
single atomic Lua script (`RESERVE_SCRIPT`, `src/stats-pipeline/budget.ts`) rather than a
client-side `INCRBY` / check / compensating `DECRBY` sequence — that three-step shape has a real
window where a failure lands *after* the `INCRBY` succeeds but *before* the `DECRBY` reaches
Redis (an `EXPIRE` throwing, a dropped connection), stranding the increment in the ledger forever
even though the caller was told the reservation was denied. Proved empirically in `budget.test.ts`
with a connection whose `eval` call throws before reaching Redis. Folding the whole reservation
into one `EVAL` removes the window structurally: from the client's point of view a reservation
either lands completely or never happened at all, the same single-round-trip failure shape as any
lone Redis command.

## 8. Idempotence

Re-ingesting a week — running the same tick's fetch and diff twice, or re-running a whole season
backfill — changes no stored number and advances no version. There is no dedup table anywhere in
the write path; idempotence comes entirely from the **storage model**:

- Stat lines are **absolute values**, upserted on `(player_id, week)` — never accumulated. There
  is nothing to add to, only a row to overwrite with the same numbers it already held.
- `stat_weeks.version` only advances when a stored value **actually changed** — not merely when
  the caller labeled a line `changed`. `persistTick`'s `onConflictDoUpdate` `where` clause
  (`changedRowWhere`, `src/db/upsert.ts`) makes Postgres itself the arbiter: a conflicting row
  whose incoming values are byte-identical to what's stored is skipped by the update and never
  appears in `RETURNING`, so the version bump is derived from what was *truly* written. This
  matters because `diffStatLines`'s notion of `changed` (a Redis digest snapshot) can be wrong in
  one direction — a lost or evicted snapshot marks every line changed again even though Postgres
  already holds the identical numbers — and Postgres's own conflict check is what stops that false
  positive from inflating the version and invalidating every cached score for nothing.
- A partial-week tick never **deletes** a row a fuller tick already wrote. "This tick returned
  fewer players than last time" is indistinguishable from an upstream hiccup, and treating it as a
  correction would let one bad response erase a Sunday's data. There is no removal path at all:
  `persistTick` had a `dropped` parameter for an explicit upstream absence that no provider signals
  and no caller ever passed, and a dead parameter with a green test defending it reads as covered
  behavior. It is gone. A player who genuinely disappears from a box score keeps his stored line,
  which is the safe direction.
- `stat_weeks.status` is **monotonic at `final`**. Two instances partition a week's games
  differently under `maxGamesPerTick`, so the one that fetched fewer of them computes
  `everyFinalGameIngested = false` from markers the other has not committed yet, and used to write
  `in_progress` over `final` — re-arming the examination window and re-spending the budget on a
  settled week. The correction sweep needs no exception: every game in the week it re-reads is
  already final and already marked, so it re-persists `final` over `final`.
- A tick's changed lines are **deduplicated by `playerId`** (last wins) and inserted in `playerId`
  **order**. The first is survival, not tidiness: `persistTick` inserts them as one multi-row
  `ON CONFLICT DO UPDATE`, and Postgres rejects the whole statement with `21000` if a conflict key
  repeats, so a player appearing in two of a week's box scores used to fail the entire tick every
  thirty minutes until upstream cleared. The second removes a deadlock class — two instances
  inserting an overlapping set in different orders take the same row locks in opposite orders.

Because idempotence is unrepresentable-as-a-bug rather than guarded-against, there is nothing to
add to keep correct that isn't already load-bearing for a different reason. The test that proves
it: `persist.test.ts`'s `"re-ingesting a week it has already ingested changes no number and no
version"`, which runs `persistTick` twice with identical input and asserts the stored rows and
`stat_weeks.version` are unchanged by the second call.

## 9. What a real vendor swap changes

**Only two files: a new `StatsProvider` implementation, and that implementation's own
`config.ts`.** Stated as what does *not* change, since that is the actual claim this document
exists to make:

- The worker (`src/stats-pipeline/worker.ts`) does not change. It calls `listGames`,
  `getGameStatLines`, `needsBoxScore` and the budget/cache/publish sequence against the
  `StatsProvider` interface, never against `mock` or `tank01` by name.
- The index (`src/stats-pipeline/index.ts`) does not change. `createStatsProvider()`
  (`src/stats/registry.ts`) is the one seam a provider name becomes an implementation through,
  selected by `STATS_PROVIDER` — adding a vendor is adding a `case`, not touching a caller.
- The cache logic (`score-cache.ts`, `reference-cache.ts`) does not change. Neither module reads
  anything provider-specific; both operate purely on `TeamScore`, `StatLine` and the
  `stat_weeks.version` signal.
- The affected-roster resolver, the persistence layer, the finalize/settlement path, and the
  contract types (`ScoreUpdatePayload`, `TeamScore`, `WeekStatus`) do not change — none of them
  import anything from `src/stats/**`.
- The budget ledger's arithmetic does not change in shape — only its configured
  `monthlyRequestBudget` moves, which is already a config value (and now an environment variable,
  `STATS_MONTHLY_REQUEST_BUDGET`), not a code path.
- The shared contract suite (`describeStatsProviderContract`) does not change. A real vendor
  adapter is verified by the exact same suite the mock and Tank01 already pass, unchanged — that
  is what makes it a proof the seam holds rather than a claim about it.

What a real vendor adapter *does* have to supply: its own `lastWeekOfSeason` and an implementation
of all four `StatsProvider` methods honoring the request-cost table in §1 (or documenting in its own docblock why it cannot,
since `budget.ts` reserves against those exact numbers), and a `config.ts` naming its own season
and rate-tier constants the way `TANK01_CONFIG` does today. Everything this document describes
above that line was built to that seam and stops there on purpose.

## 10. The correction window

A week, once settled, used to be unrevisable: `weeksToExamine` walked forward from the first
NON-final row, so a `final` week never came back; `needsBoxScore` refused a game whose `finalGame`
marker existed; `finalizeWeek` ran only on the transition; and the manual scoring route was deleted
in Task 8. NFL official scoring revisions run into the following week, and `final-only` records
whatever the box score said the first moment the provider called the game final — by construction
the earliest and least settled version of it. So the season record was frozen at a number the league
itself no longer agreed with, permanently, with no operator path back short of direct SQL.

The **correction sweep** closes it. The examination window additionally includes the most recent
`final` week for `STATS_INGESTION_CONFIG.correctionWindowDays` (3) after its `stat_weeks.updated_at`,
re-reading that week's box scores at most once per calendar day — a Redis marker
(`STATS_INGESTION_CONFIG.keys.correctionSweep`) is what makes it once, and the tick that SETTLED the
week counts as that day's read, so the first sweep is the next day's. Inside a sweep,
`needsBoxScore` ignores both the `finalGame` marker and `final-only`'s fetch-once rule, because
re-reading is the entire point.

Nothing downstream needed building: `persistTick` and `finalizeWeek` are already
recompute-and-overwrite idempotent, so a landed revision flows into `player_stat_lines`, bumps
`stat_weeks.version` (which propagates to the score cache and every open matchup page over SSE),
re-settles `matchups` through `finalizeWeek`, and reaches the standings by `computeStandings`
reading those rows. That is why the sweep is cheap to have: the machinery it drives already existed
and was only missing a caller.

**A sweep that finds nothing writes nothing** — not even `updated_at`. The window is measured from
`updated_at`, so a no-op write would push its own deadline out by a day on every pass and the window
would never close. A sweep that DOES land a revision bumps it, which extends the window by three
more days from the revision: a week that was corrected once is the likeliest week to be corrected
again.

**A sweep only claims the day if it read the whole week.** The live weeks take what they need of
`maxGamesPerTick` first, so a busy Sunday can leave the sweep with too little budget to fetch the
week it came for — and a denied box-score reservation empties its fetch list entirely. Either way
the day is left unclaimed and the next tick retries it, because three chances is the whole window
and spending one of them on a sweep that examined nothing is spending a third of the coverage. The
sweep's own schedule call is reserved separately and skipped altogether when there is no game budget
left to act on it, so a starved tick costs nothing rather than paying for a schedule it cannot use.

What is still out of scope: a revision that arrives after the window closes, and a revision to any
week but the most recent settled one. Both are deliberate — the sweep costs 17 requests a day and
the ledger has to hold — and both are visible rather than silent, because the numbers above say what
a wider window would cost.

## 11. A wedged week, and a league that drafts late

Two ways the pipeline used to lose a week permanently, both closed by the same instinct: prefer the
state that keeps moving.

**A wedged week.** A postponed or cancelled game whose upstream status never flips, or a game whose
box score permanently 404s, pins the examination window on one week forever — and since the window
starts at the earliest non-final week, every later week is never examined again. The worker counts
how many consecutive ticks the window has opened on the same un-advanceable week, and past
`STATS_INGESTION_CONFIG.wedgedWeekTicks` (384, eight days at the default cadence, deliberately
longer than the ~336 ticks a healthy week is unsettled for) it logs loudly on the `warnIntervalMs`
rate limit and widens the window.

It widens to the wedged week PLUS a full window opening at the first non-final week AFTER it — not
simply to two weeks. Widening to `[wedged, wedged + 1]` buys the season exactly one week and then
stalls again at `wedged + 1`, which mitigates the failure rather than closing it. Widen, never
skip: the stuck week is still examined every tick, because its games may yet be played.

The warning names how many passes the week has taken, but the count is deliberately NOT part of
what rate-limits it. A limiter keyed on a message containing a counter is a fresh key every tick,
which limits nothing and retains an entry for each — the wedge warning did exactly that until the
rate-limit key was made stable per wedged week and the map was bounded to entries still suppressing
something.

**A league that drafts late.** `finalizeWeek` refuses an undrafted league — its rosters do not exist
yet, so every team would score zero and the standings would show a season of phantom losses — and
the tick that settled the week moved on. A league drafting on a Sunday afternoon silently forfeited
that week from its record. The worker now catches those up from the DATA rather than from a flag the
draft would have to remember to write: a `matchups` row in a `final` week with no score is exactly
the state that needs settling, whatever produced it. Bounded at
`STATS_INGESTION_CONFIG.maxSettlementsPerTick` per tick, so a league that completes a mid-season
draft catches up over a few ticks rather than doing a season of settlement writes inside one.

## 12. Cross-instance serialization

`src/instrumentation.ts` starts the worker in EVERY Node process, and the phase's own scaling
ceiling is four instances. Without serialization each one fetches every unmarked box score
independently: N times the upstream spend, N times the ledger debit, and two publishes stamped with
the same `stat_weeks.version` where the second — often the fresher — is dropped by
`useLiveScores`'s version gate.

The tick takes a **best-effort Redis lease**: `SET NX PX` on
`STATS_INGESTION_CONFIG.keys.tickLease`, held for one poll interval, released on completion with a
compare-and-delete script so a tick that overran its TTL cannot delete the next instance's freshly
acquired lease. A held lease skips the tick entirely, before any reservation or any upstream call.

Best-effort is the design, not a shortcut, and the failure mode is stated rather than guarded: if
Redis is unreachable the tick runs UNLEASED. Duplicate work is safe — persistence is idempotent by
storage model and serialized by the `stat_weeks` primary key (§8) — so the cost of a Redis outage is
requests, never correctness. A lease that failed closed would take live scoring down whenever Redis
hiccuped, which is strictly worse. A Postgres row lock was rejected for a different reason: it would
have to span the HTTP fetch phase, pinning a pooled connection on external latency, which this
codebase avoids everywhere else.

## 13. Who writes the score cache

The ingestion worker, and only the worker. `publishAffected` writes each affected league's computed
scores at the version `persistTick` just returned, immediately before the SSE publish and after the
commit — the values are already in hand, so it costs no query. `src/stats-pipeline/index.ts` wires
the same `getScoreCache()` singleton the read paths use, so the version a value is stamped with and
the version a read compares against are two ends of one key.

This is what makes `crossLeagueHome`'s live branch real. Before it, `ScoreCache.write()` had no
production caller anywhere: the home board's `MGET` always missed, an `in_progress` week fell
through to `matchups.home_score` (null until settlement), and every live league rendered a dash on
the one afternoon the number matters. `setLineup`'s invalidation deleted a key that never existed,
and `finalizeWeek` now invalidates too — the cached value was computed from a week in progress, and
after settlement the numbers that stand live in `matchups`.
