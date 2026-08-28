# What a live season needs

**Status:** scoping note, 2026-08-28. Written while wiring the projection engine's output into the
player screen for the first time, because half of that wiring landed and half of it could not.

## The one-line version

Expert consensus for the season a league is actually playing is **in the product now**. Our own
board for that season is **not, and is a larger job than this one**: it needs a season of ingested
data that nflverse has not published, and a second definition of "the preseason moment" that the
engine does not have. Neither is a day's work and neither should be half-built.

## What landed

`player_crosswalk` joins the two id spaces by id (`docs` in `src/projections/crosswalk.ts`), so
anything keyed to a gsis id can now be addressed by a `players.id`. On top of it:

- **Expert consensus, 2026.** FantasyPros publishes the current board and it was fetched, resolved
  against the product's own roster through the crosswalk, and stored: 441 of the 518 names on the
  publisher's board, 85.1%. 441 of 1,647 league players carry an expert rank; more usefully, **432
  of the 476 players the market ranks do (90.8%)**, which is the population anybody actually opens a
  player screen for. The 77 unresolved names are **32 team defences, 35 kickers and 11 people**.
  Neither a defence nor a kicker is projected by this engine or placeable by the crosswalk, and the
  eleven are ranked 385th to 504th and are almost all fullbacks the publisher lists as running backs
  and the product's roster does not carry at all. There is no miss above rank 385.
- **Our board, 2021 to 2024.** 2,662 rows in `preseason_projections`, each stamped with the
  preseason moment its board was taken at.
- **2026: nothing.** The Model cell prints a dash for every player, and the reason is below.

## Why there is no 2026 board

Three blockers, in order of how much work each is.

### 1. The preseason moment is defined by games that have already been played

`preseasonMomentFor` (`src/projections/preseason/source.ts:285`) derives a board's moment as one
millisecond before the earliest game-derived stamp the season carries, and **throws** when the
season has none:

> The store holds no game-derived observations for 2026, so its preseason moment cannot be derived.

That is the right derivation for a backtest and it is the only one the engine has. It is not a bug:
it is the mechanism that makes a replay structurally unable to read past its own moment, and it is
the reason `assertNothingFromTheSeasonIsVisible` can be an assertion rather than a hope. But it means
the engine can only build a board for a season it can already see the end of.

A live board needs a **second moment definition — `now`** — and the two must not be able to be
confused for each other, because a board stamped `now` and scored against a finished season would be
the third leakage defect. The shape is probably a discriminated `BoardMoment` (`{ kind: "replay" }`
against `{ kind: "live", at: Date }`) threaded through `loadPreseason`, with the assertion kept for
the replay arm and replaced by "refuse any observation from this season at all" for the live one.
Call it a day of careful work and a day of audit.

### 2. The 2025 season is not ingested, and cannot be by the path that exists

A board for season S reads three prior seasons (`HISTORY_SEASONS = 3`), so a 2026 board needs 2023,
2024 and 2025. The backfill covers 2020 to 2024.

Checked against the live nflverse releases on 2026-08-28:

| asset the ingest asks for | 2025 |
| --- | --- |
| `snap_counts/snap_counts_2025.csv` | present |
| `player_stats/stats_player_week_2025.csv` | **404** |
| `pbp/play_by_play_2025.csv` | present, 98 MB |
| `depth_charts/depth_charts_2025.csv` | present |
| `weekly_rosters/roster_weekly_2025.csv` | present |

The `player_stats` release carries 1,822 assets and **not one of them names 2025**; the newest
`stats_player_week_*` is 2024. That file is the outcomes feed — the targets numerator and the
actuals every backtest scores against — so the season cannot be ingested by the path that exists,
whatever else is available. Two options, and they are not equivalent:

- **Wait** for nflverse to publish it. Free, and outside our control on a community project with no
  SLA, which is the exact dependency `NFLVERSE_CONFIG`'s docblock warns about.
- **Derive weekly stat lines from play-by-play**, which the repository already does in part
  (`src/projections/nflverse/pbp-players.ts`). This is the real option, and it is a measured piece
  of work rather than a mapping: a derived stat line has to be reconciled against a season we have
  both feeds for before it is allowed to feed a model, or every 2026 projection rests on an
  unvalidated recomputation of its most important input.

### 3. Two stamps claim the future

Smaller, and worth naming because both fail silently in the same direction.

- `week1RosterAsOf(season)` is 1 September. Today is 28 August; nflverse has already published the
  2026 week-one rosters (2,930 rows, week 1, REG) and the league's cutdown deadline has passed, so
  the fact is knowable and the stamp says it will not be for four more days. Nothing reads it yet,
  which is exactly the state the injury feed was in when it silently gated itself out of every board
  the engine had ever built.
- The ECR stamp had the same defect and **was fixed in this track**: `parseExpertConsensus` now
  bounds its September convention by the moment the page was actually read. For an archive the
  convention still wins, so no published measurement moved; for a live board we knew it when we saw
  it. The roster stamp deserves the same treatment and did not get it here, because it is
  load-bearing for four seasons of published numbers and moving it belongs in a change that
  re-measures them.

## What is NOT blocking

- **The fitted model.** Priors were fit on 2021 to 2022 and held out on 2023 to 2024. Applying them
  to 2026 is what a fitted model is for. The honest caveat is that **no measurement of a 2026 board
  can exist until 2026 has been played**, and the scoreboard should say so rather than quoting the
  held-out figure beside a live board as though it were about this one.
- **Market ADP.** `players.adp` is already live from the stats provider and already on the screen.
  `ffc_adp_ppr_12` for 2026 would be a nice-to-have for like-for-like benchmarking, not a blocker.
- **The crosswalk.** Built, stored, audited. It is the one piece of this that is finished.

## The order to do it in

1. Reconcile play-by-play-derived stat lines against 2023 and 2024, where both feeds exist. If they
   do not agree, stop: everything after this rests on them.
2. Ingest 2025 from the derived path.
3. Add the live moment, with the replay arm untouched and the audit written first.
4. Ingest 2026 week-one rosters and depth charts, fixing `week1RosterAsOf` in the same change and
   re-running the four published measurements to show they did not move.
5. Build, persist and render the 2026 board. The Model cell fills itself the moment a row exists.

Steps 1 and 2 are the bulk. Nothing before step 5 is visible to a user, which is the honest reason
this was scoped rather than started.
