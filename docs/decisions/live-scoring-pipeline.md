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

`getWeeklyStatLines` stays on the interface anyway, as a **composition of the other two**, not a
second implementation of "this week's stats." `seedPlayers` still walks weeks upward with it
until it gets an empty array, and removing it would break that for no gain. Keeping it as an
independently-written method would be two expressions of the same fact that could quietly drift;
the shared contract suite (`describeStatsProviderContract`, `src/stats/test-support.ts`) asserts
the per-game reads sum to exactly the same lines the week-level read returns, which is the
cheapest way to keep two things agreeing forever: make one of them *be* the other.

## 2. The budget arithmetic

This is the section a founder reads before buying a tier. `STATS_INGESTION_CONFIG`
(`src/stats-pipeline/config.ts`) carries the arithmetic in its own docblock, reproduced here:

| Cadence | Requests per Sunday | Per month (4.3 weeks) | Fits 1,000? |
|---|---|---|---|
| Poll every game every 5 minutes across a 10.5h Sunday | 126 polls x (1 schedule + ~10 live games) ~= 1,386 | ~5,960 | No, by 6x |
| Poll every game every 15 minutes | 42 x 11 ~= 462 | ~1,990 | No, by 2x |
| Poll the schedule every 30 minutes, fetch each box score exactly once, when it first reports final | 24 schedule calls + 16 box scores = 40 | ~195 (with Thursday and Monday) | Yes, with room |

That third row is `final-only` mode, and it is the default `STATS_INGESTION_CONFIG.mode` ships
with, because it is what the provider tier that existed when this was written could afford. It
polls the schedule every `pollIntervalMs` (30 minutes) and fetches a game's box score exactly
once — the first tick it reports final, tracked by the `finalGame` Redis marker — never again
after. `live` mode fetches every non-final game's box score on every tick instead, which is what
the first two rows cost: it is the shape that shows a score moving mid-quarter rather than only
once a game ends, and it is fully built and tested today. Turning it on is a config value
(`STATS_INGESTION_MODE=live` or `STATS_INGESTION_CONFIG.mode`), not a code change — nothing in
this plan waits on that decision, because the mock provider runs either mode at zero request
cost, so both are exercised in tests regardless of which one is live.

**Where this stands today:** a paid Tank01 tier is approved and the key already lives in
`.env.local`. `STATS_MONTHLY_REQUEST_BUDGET` (and `STATS_INGESTION_CONFIG.monthlyRequestBudget`)
stays at its `1,000` default until the founder names the purchased quota — raising the ceiling
before that number is known would just move where the ledger denies a reservation, not change
what the upstream account actually allows. `live` mode is the launch target: `final-only` is safe
and cheap enough to run against the free tier's arithmetic today, but a manager watching a score
move only at the final whistle is not the product. Flipping `STATS_INGESTION_MODE=live` once the
paid quota is known is the whole rollout — no other change.

`STATS_INGESTION_CONFIG.reservedForBackfill` (150 of the 1,000) is held out of the ingestion
budget `RequestBudget.reserve()` draws against, so a live season's polling can never starve
`npm run seed`'s ability to backfill a season (about 300 requests for 18 weeks against a
`listPlayers` + `getWeeklyStatLines` walk — see `docs/decisions/stats-provider-adapter.md`).

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
  correction would let one bad response erase a Sunday's data. Removal (`persist.ts`'s `dropped`
  parameter) only ever comes from an explicit upstream absence inside a game the tick actually
  fetched — never inferred from a shrinking row count.

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
  `monthlyRequestBudget` moves, which is already a config value, not a code path.
- The shared contract suite (`describeStatsProviderContract`) does not change. A real vendor
  adapter is verified by the exact same suite the mock and Tank01 already pass, unchanged — that
  is what makes it a proof the seam holds rather than a claim about it.

What a real vendor adapter *does* have to supply: an implementation of all four `StatsProvider`
methods honoring the request-cost table in §1 (or documenting in its own docblock why it cannot,
since `budget.ts` reserves against those exact numbers), and a `config.ts` naming its own season
and rate-tier constants the way `TANK01_CONFIG` does today. Everything this document describes
above that line was built to that seam and stops there on purpose.
