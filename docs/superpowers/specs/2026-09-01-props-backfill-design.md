# Props Backfill: the historical player-prop archive, 2023-2025

Date: 2026-09-01
Status: approved direction (founder: "we need player level stats as well"; Round A of the batched
intelligence roadmap; speed calibration applies: lean loop, data-only, no measurement this round)
Owner: engine
Backbone: docs/research/2026-09-01-vegas-laws-closeout.md (the props archive section and its
designed next round)

## What this round is, and is not

IS: filling the props archive backward. The Odds API historical snapshot endpoint (verified
accessible on the current key) serves point-in-time NFL event odds back to May 2023. This round
ingests one pre-kickoff snapshot per week for the 2023, 2024 and 2025 seasons into the existing
append-only props store, and builds the player-name resolution map the anchor test will need.

IS NOT: any measurement, any anchor test, any model or board change. Props-as-anchor is Round C's
question, measured in one combined fit round. Nothing outside src/projections/odds/ and its
scripts changes.

## Part 1 - The backfill

- For each season 2023-2025, for each regular-season week: pick ONE snapshot instant shortly
  before the week's first kickoff (the honest "what the market said before the games" record),
  list events via the historical events endpoint at that instant, then fetch the four verified
  player markets (player_pass_yds, player_reception_yds, player_receptions, player_rush_yds,
  US region) per event via the historical event-odds endpoint.
- Rows land in the EXISTING props store (migration 0064) with fetched_at = the archive snapshot
  timestamp (the API's own), never wall-clock now: the archive's honesty is its timestamps.
- 2023 coverage starts where the archive does (May 2023 onward covers the whole 2023 season);
  any week the archive cannot serve is recorded as a gap, never synthesized.
- BUDGET: historical event-odds calls are the expensive unit. The script tracks credits from the
  response headers, prints running totals, accepts a --budget flag (default 9000 for the whole
  backfill), and STOPS cleanly at the budget with a resume point (season/week), never mid-week.
  Resumability: a re-run skips season-weeks already present in the store (idempotent by
  event id + market + bookmaker + fetched_at).

## Part 2 - Name resolution

- A mapping from the API's player name strings to nfl_players ids, built offline from the
  archived rows: exact-name match against rosters of the matching season first, then documented
  normalization (suffixes, punctuation, diacritics). Ambiguities (two players, one name, same
  season) and misses land in an unmatched report, never guessed.
- Stored as its own small table (props_player_map) so the anchor test reads a stable join, with
  the match method recorded per row.
- Target stated honestly: report the match rate; do not chase 100% by loosening rules. QB/RB/WR/TE
  on the four prop markets should resolve in the high 90s by count of observations.

## Constraints

As every round: serial vitest, tri-state, fail fast, no em-dashes printed, figures from runs.
Secret hygiene: the key stays in env; printed URLs never include it. The store stays append-only.
Lean review per the speed calibration: one batched implementer, one focused reviewer.
