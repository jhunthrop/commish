# Research data sources

Every recurring feed the research package (`research/`) pulls, where from, how often, into which
store source, and on what terms. Operator-only ingests (run by hand, once per store or per season)
are listed after the recurring ones. Last checked 2026-10-14 (Lane 23).

## The founder's rule on Pro Football Reference

No manual or recurring Pro Football Reference or Stathead pulls, ever (founder, 2026-09-05). A
figure that cannot be pulled by an automated, permitted feed is skipped. nflverse's own
`pfr_advstats` release is a nflverse source, not a PFR pull: nflverse builds and publishes it, and
the research package reads only that release. It is listed below on those terms.

## Recurring feeds

nflverse release assets are read from `https://github.com/nflverse/nflverse-data/releases/download/<release>/<file>`
through `NflverseClient` (`research/pipeline/nflverse/client.py`), with an HTTP timeout and, for the
in-season usage feeds, a per-asset byte cap (`config.ByteCaps`).

| Feed | Provider, release and file | Cadence (job) | Store source | Terms |
|---|---|---|---|---|
| Player universe | nflverse `players/players.csv` | Tue, Wed, Thu in season (`inseason` season-week, `stats-ingest`) | `research.players` | nflverse-data repository: CC-BY 4.0 |
| Weekly player stats | nflverse `stats_player/stats_player_week_<season>.csv` (2025 on; `player_stats` before) | same | `nflverse_player_week` | CC-BY 4.0 |
| Snap counts | nflverse `snap_counts/snap_counts_<season>.csv` | same | `nflverse_snap_counts` | CC-BY 4.0 |
| Schedule and results | nflverse `nfldata` repository, `data/games.csv` (raw.githubusercontent.com) | same, and each usage step that stamps by week | `nflverse_kickoff`, `nflverse_schedule` (team-week) | nflverse |
| **Play-by-play, current season** | nflverse `pbp/play_by_play_<season>.csv` (and `.csv.gz` for the FTN join) | same (`play-by-play` step, new in Lane 23; before it, history only) | `nflverse_pbp` (team-week), `nflverse_pbp_player`, `nflverse_pbp_passer` (new: dropbacks) | CC-BY 4.0 |
| **FTN charting** | nflverse `ftn_charting/ftn_charting_<season>.csv` (2022 on), joined to play-by-play | same (`ftn-charting` step, Lane 23) | `nflverse_ftn_charting` | **CC-BY-SA 4.0, attribution "must be made to FTN Data via nflverse"** (nflreadr `load_ftn_charting`); see below |
| **Next Gen Stats** | nflverse `nextgen_stats/ngs_<passing\|receiving\|rushing>.csv.gz` (all seasons, rebuilt nightly; the per-season files stopped at 2024) | same (`next-gen-stats` step, Lane 23) | `nflverse_ngs` | nflverse states no licence for this release; the data is the NFL's Next Gen Stats |
| **PFR advanced stats** | nflverse `pfr_advstats/advstats_week_<pass\|rec\|rush>_<season>.csv` (2018 on) | same (`pfr-advstats` step, Lane 23) | `nflverse_pfr_advstats` | nflverse states no licence for this release; the data is Pro Football Reference's. A nflverse source under the founder's rule above |
| Player props | The Odds API (`api.the-odds-api.com/v4`, `ODDS_API_KEY`) | the in-season pass; nightly before kickoff | `player_prop_observations` | paid key, the provider's terms |
| Tank01 captures | Tank01 on RapidAPI (`TANK01_API_KEY`): injuries by date, news, depth charts, inactives, betting odds | hourly 07:00 to 23:00 and 02:00 ET (`inseason-capture`), and nightly | `capture_snapshots` (`tank01_*`) | paid plan, the provider's terms |
| ADP | Fantasy Football Calculator (`fantasyfootballcalculator.com/api/v1/adp/<format>`) | nightly | `adp_snapshots` | the publisher's public API |
| Host player ids | dynastyprocess `files/db_playerids.csv` (GitHub) | nightly | `research.players` host ids | the repository's terms |
| Season win totals | nfelo `win_totals.csv` (greerreNFL/nfelosrs on GitHub) | nightly, before kickoff only | `vegas_win_totals` (team-week) | the repository's terms |

## Operator-only ingests (not recurring)

nflverse injuries, weekly rosters, depth charts, draft picks, team weekly stats, and play-by-play for
2003 to 2025 (`python -m research.pipeline history`, `context`, `roster-weeks`, `draft-picks`, `kdef`,
`preseason`); the published preseason boards (FantasyPros, the publishers in
`research/pipeline/preseason/publishers.py`); and the committed play-caller and win-total seeds.

## FTN charting: the licence and the switch

- What nflverse says (nflreadr `load_ftn_charting`, read 2026-10-14): "FTN Data manually charts plays and
  has graciously provided a subset of their charting data", "This data is released under the CC-BY-SA
  4.0 Creative Commons license and attribution must be made to FTN Data via nflverse", and the
  suggested credit "ftndata.com via nflverse". The release itself says "Charting data provided by
  https://FTNFantasy.com/data".
- CC-BY-SA 4.0 does not forbid commercial use. It requires the credit wherever the material or an
  adaptation of it is shared, and that adaptations be shared under the same licence.
- The site carries no FTN credit today, and whether a paid page's prose built on FTN figures is an
  adaptation the share-alike term reaches is a question for counsel, not for this lane.
- So the ingest stores FTN's charting (storage is not sharing), and the capsule writer's sheet carries
  no FTN-derived figure while `CapsuleConfig.ftn_charting_on_pages` is False (`research/capsules/config.py`).
  Turning it on wants the credit on the page and the share-alike ruling first.

## Not tracked, and why

- Routes run, targets per route run and yards per route run: no automated permitted feed publishes
  them for the current season. nflverse's `pbp_participation` names only the targeted receiver's
  route (`route`), never every player who ran one, and it has no 2026 file (2016 to 2025 only); FTN's
  charting has no route column.
- A quarterback's pressure from FTN: FTN does not chart pressure. Pressure comes from
  `nflverse_pfr_advstats` (`times_pressured`) over the play-by-play's dropbacks (`nflverse_pbp_passer`).
