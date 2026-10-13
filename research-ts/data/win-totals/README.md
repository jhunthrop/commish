# Vegas win totals, 2003-2026

`win-totals.csv` is the preseason regular-season win total market for every team, every season
from 2003 through 2026: the line, the over and under prices, and (where the season is complete
and the store has schedule coverage) the team's actual regular-season win total. It is an internal
model input for the laws work this dataset feeds; nothing here is redistributed or rendered in
product.

## Provenance and license

The raw material is the committed CSV in [`github.com/greerreNFL/nfelosrs`](https://github.com/greerreNFL/nfelosrs)
(`nfelosrs/Manual Data/win_totals.csv`), fetched once on 2026-09-01 into
`.superpowers/sdd/2026-09-01-vegas-laws/raw-win-totals-nfelosrs.csv` (768 rows, 32 teams times 24
seasons, columns `season/team/line/over_odds/under_odds/source/source_date`). That repository
carries no license file. The rows are factual betting lines (facts, not copyrightable expression),
and this project's use of them is internal-model-input-only, attributed here, with no
redistribution surface — the same shape as this project's PFR/Stathead ruling. If that reading is
ever wrong, the schema is source-agnostic and the fallback is a `covers.com` archive parse.

## Columns

| Column | Meaning |
| --- | --- |
| `season` | The NFL season the win total was posted for. |
| `team` | Canonical team code, matching nflverse's `games.csv` spelling for that season (see below). |
| `win_total` | The posted regular-season win total line. |
| `over_price` | American odds on the over. |
| `under_price` | American odds on the under. |
| `actual_wins` | Regular-season wins (ties count as 0.5), where derivable. Empty, never zero, where it is not. |
| `source` | `draftkings` for 2025 and 2026 (real tracked publication), `not_tracked` for 2003-2024 (nfelosrs carries no book/date for those seasons and stamps a documented convention date instead). |
| `source_date` | When the line became knowable. See "The stamp" below. |

## Team codes

`team` is normalized to whatever nflverse's `games.csv` spells that franchise in that season —
the same ground truth `src/projections/nflverse/team-eras.ts` already encodes for this repo's own
ingestion (`nflTeamsBySeason`). The raw nfelosrs CSV disagrees with that spelling in two places,
both corrected during curation:

- **Rams**: nfelosrs spells the franchise `LA` for 2016-2020 and switches to `LAR` from 2021
  onward. nflverse spells it `LA` for every season from 2016 on and never uses `LAR`. Every `LAR`
  row is normalized to `LA`.
- **Raiders**: nfelosrs spells the franchise `OAK` through 2019, `LV` for the single 2020 season,
  and then reverts to stamping `OAK` again from 2021 through 2026 — nfelosrs' own data quality
  quirk, not a second relocation. nflverse spells the franchise `LV` for every season from 2020
  on. Every `OAK` row for a season 2020 or later is normalized to `LV`.
- **Chargers** (`SD` through 2016, `LAC` from 2017) and the Rams' own pre-2016 `STL` spelling
  needed no correction; nfelosrs already matches nflverse there.

`scripts/validate-win-totals.ts` checks this directly: every season's 32 team codes must equal
`nflTeamsBySeason(season)` exactly, so a drift in either direction fails validation rather than
passing silently.

## The stamp

Per the sourcing ruling, `source_date` is preserved from the raw CSV as the publication stamp: the
book's own tracked date for 2025 and 2026 (`draftkings`), and nfelosrs' `not_tracked` convention
date (August 30 of that season) for 2003-2024, where no book or exact date is recorded. Every
`source_date` is validated to strictly precede that season's first kickoff — the store's own
`firstKickoffFor` (`src/projections/team-store.ts`) for the sixteen seasons the store has schedule
coverage for (2011-2026), and a conservative documented convention (September 1 of that season, a
date no NFL regular season in this span has ever opened before) for 2003-2010, where the store has
no schedule at all. Task 2 reads this stamp; nothing here re-derives it.

## `actual_wins`

Computed by `scripts/validate-win-totals.ts` from nflverse's own `games.csv` — the exact file and
URL `src/projections/nflverse/schedule.ts` reads for the store's own schedule ingestion, fetched
at validation time rather than cached, so a stale local copy can never silently diverge from what
the store would ingest. This is a live network fetch, and it is a deliberate exception to "do not
fetch anything from the web": that ruling was about not re-sourcing the win-totals market data
itself (already fetched once, by the controller); `actual_wins` is a different fact entirely, and
this repo's own schedule store already depends on fetching this same file over the network as its
normal operation (`npm run projections:context`, `ingestSchedule`). If that reading is wrong,
flag it — the fetch is isolated to one function and easy to replace with a committed fixture.

A team-season's wins are filled only when the store has ingested schedule data for that season
**and** every one of that team's regular-season games (one fewer than the season's week count, for
the bye) has a final score. A tie counts as half a win. Where either condition fails, `actual_wins`
is left empty — never zero, which would claim a winless season nobody played:

- **2003-2010**: the store has no schedule coverage at all (its schedule ingestion starts at
  2011). `actual_wins` is empty for all 256 rows in this span, and the README says so rather than
  leaving a reader to guess why.
- **2026**: the store has schedule coverage (the season's slate is published) but no game has been
  played yet as of this dataset's curation (2026-09-01, preseason). `actual_wins` is empty for all
  32 rows.
- **2022, BUF and CIN**: the January 2, 2023 Bills-Bengals game was canceled after Damar Hamlin's
  on-field cardiac arrest and never made up; the NFL settled both teams' regular seasons at 16
  games instead of 17. Both teams cleared their divisional and playoff seeding on 16 games, but
  that total is not comparable to every other 2022 row's 17-game record, so `actual_wins` is left
  empty for these two rows specifically rather than reporting a shortened-season count next to
  full-season counts for the same market year. Every other 2022 team has all 17 games and a filled
  `actual_wins`.

## Ingesting

`win-totals.csv` is the reviewed input to `npm run projections:vegas:ingest`, which writes every row's
three metrics to `team_week_observations` under the `vegas_win_totals` source. Nothing in the server
reads this file: the product reads the table. The file read lives in `scripts/lib/win-totals-csv.ts`.

## Validating

```
npm run projections:win-totals:validate
```

Checks, independently, and never averaged away:

1. **Row counts and team codes** — every season 2003-2026 carries exactly its canonical 32 teams
   (`nflTeamsBySeason`), no duplicate, no substitute, no extra.
2. **Ranges** — `win_total` is between 0 and 17; `over_price`/`under_price` read as American odds
   (integer, magnitude at least 100 — a `+100`/`-100` pick'em line passes, and the raw CSV has no
   `even`-as-text rows to special-case).
3. **`source_date` precedes kickoff** — parses, and strictly precedes the season's first kickoff
   (store-derived where available, the documented convention otherwise).
4. **`actual_wins` matches the store** — every row whose season the store has schedule coverage
   for is checked against the schedule-derived record computed above; every mismatch prints
   individually with the season, team, expected and actual value, and the run exits 1. A row the
   store cannot yet verify (an incomplete or uncovered season) is checked for the opposite claim:
   that `actual_wins` is correctly left empty.

`scripts/validate-win-totals.test.ts` drives the four pure check functions from fixture rows with
no database or network involved, so the logic is provable before it ever touches Postgres or
nflverse.

## Independent line cross-check (covers.com archive, per the spec)

Performed 2026-09-01 against the covers.com sportsoddshistory archived win-total tables
(`covers.com/sportsoddshistory/nfl-win/?y=YEAR`), an archive independent of the nfelosrs
source this dataset was curated from. Three spot seasons spanning the dataset's eras were
compared line by line, all 32 teams each:

- 2005: 32 of 32 lines match exactly.
- 2013: 32 of 32 lines match exactly.
- 2019: 32 of 32 lines match exactly.

96 of 96 lines agree with zero mismatches (comparison script preserved in the round's
workspace, `covers-crosscheck.ts`; era relocations mapped per the table above). Odds were
not compared: books and capture dates differ between archives, and the spec's cross-check
targets the lines themselves.
