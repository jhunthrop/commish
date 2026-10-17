"""THE ROUND'S PRECONDITIONS (preregistration section 6.3), checked on the scratch copy before any fit
and recorded in the results. A missing one refuses the run and is named:

- every input of section 2 present for its seasons: the play table 2016 through the judged season,
  weekly depth charts, NGS 2016 on and PFR 2018 on, the roof state for every game (`game_weather`,
  amendment 1 item 3), a stadium row for every `stadium_id` the game table names,
- the game figures for every club-week with a game (512 a season to 2020, then 544 / 542 / 544 / 544),
- the recorded temperature, wind and precipitation for every outdoor game after the fill, or the count
  left at the default (reported per season, not a refusal: 2.10 gives the default),
- the depth chart stamp check run and its verdict recorded in the results (pass: the week-W chart,
  fail: week W-1's), and the store built under that verdict,
- round 3's preconditions (its `missing_preconditions`).

Round 3's code reproducing its development check's 26 lines is checked by the run itself before its
number is used (`round_three.reproduction`).
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.weekly2.judge import DOCS
from research.model.weekly3.preconditions import missing_preconditions as round_three_missing
from research.model.weekly3.preconditions import read_counts as round_three_counts
from research.model.weekly4.gates import RoundFour
from research.pipeline.nflverse.ngs import NGS_SOURCE
from research.pipeline.nflverse.pfr_advstats import PFR_SOURCE

RESULTS: Final = DOCS / "2026-10-16-weekly-projection-round4-results.md"
FIRST_SEASON: Final = 2016
FIRST_PFR_SEASON: Final = 2018
# 6.3: "512 a season to 2020, then 544 / 542 / 544 / 544, as counted".
EXPECTED_FIGURES: Final = MappingProxyType(
    {**dict.fromkeys(range(2016, 2021), 512), 2021: 544, 2022: 542, 2023: 544, 2024: 544}
)


@dataclass(frozen=True, slots=True)
class Counts:
    plays: Mapping[int, int]
    charts: Mapping[int, int]
    ngs: Mapping[int, int]
    pfr: Mapping[int, int]
    roofs: Mapping[int, tuple[int, int]]  # season: (games with a roof state, games)
    figures: Mapping[int, int]  # season: club-weeks with the implied points
    stadiums_missing: int
    weather: Mapping[int, Mapping[str, int]]  # season: outdoor games, and those missing a value
    round_three: list[str]


def depth_chart_verdict(results: Path = RESULTS) -> str | None:
    """The recorded verdict of the depth chart check (section 1 of the results): 'week' on a pass,
    'prior' on a fail, None when no verdict is recorded."""
    if not results.exists():
        return None
    found = re.search(r"## 1\. The depth chart stamp check.*?\*\*(PASS|FAIL)\*\*", results.read_text(), re.DOTALL)
    if found is None:
        return None
    return "week" if found.group(1) == "PASS" else "prior"


def _seasons(t: RoundFour, first: int = FIRST_SEASON) -> range:
    return range(first, t.judgment_season + 1)


def missing_preconditions(counts: Counts, t: RoundFour, verdict: str | None, built: str | None) -> list[str]:
    missing: list[str] = []
    for season in _seasons(t):
        if counts.plays.get(season, 0) <= 0:
            missing.append(f"play table rows for {season}")
        if counts.charts.get(season, 0) <= 0:
            missing.append(f"weekly depth chart rows for {season}")
        if counts.ngs.get(season, 0) <= 0:
            missing.append(f"NGS rows for {season}")
        if season >= FIRST_PFR_SEASON and counts.pfr.get(season, 0) <= 0:
            missing.append(f"PFR rows for {season}")
        roofed, games = counts.roofs.get(season, (0, 0))
        expected = EXPECTED_FIGURES[season] // 2
        if roofed < games or games < expected:
            missing.append(f"a roof state for {expected - roofed} of {expected} games of {season}")
        if counts.figures.get(season, 0) < EXPECTED_FIGURES[season]:
            missing.append(
                f"{EXPECTED_FIGURES[season]} game figures (implied points) for {season}, found {counts.figures.get(season, 0)}"
            )
    if counts.stadiums_missing:
        missing.append(f"a stadium row for {counts.stadiums_missing} stadium ids the game table names")
    if verdict is None:
        missing.append("the depth chart check's verdict recorded in the results")
    elif verdict != built:
        missing.append(f"the store built under the recorded verdict ({verdict}), not {built}")
    missing += [f"round 3's precondition: {m}" for m in counts.round_three]
    return missing


def _by_season(conn: Connection, sql: str, params: Mapping[str, Any]) -> dict[int, int]:
    return {int(r.season): int(r.n) for r in conn.execute(text(sql), dict(params))}


def read_counts(conn: Connection, t: RoundFour) -> Counts:
    seasons = list(_seasons(t))
    by = {"seasons": seasons}
    observations = (
        "select season, count(*) as n from research.player_week_observations "
        "where source = :source and season = any(:seasons) group by season"
    )
    roofs = {
        int(r.season): (int(r.roofed), int(r.games))
        for r in conn.execute(
            text(
                "select season, count(roof) as roofed, count(*) as games from research.game_weather "
                "where season = any(:seasons) group by season"
            ),
            by,
        )
    }
    weather = {
        int(r.season): {"outdoor": int(r.outdoor), "missing": int(r.missing)}
        for r in conn.execute(
            text(
                "select season, count(*) as outdoor, count(*) filter (where temperature_f is null or wind_mph is null "
                "or precipitation is null) as missing from research.game_weather where roof in ('open', 'outdoors') "
                "and season = any(:seasons) group by season"
            ),
            by,
        )
    }
    stadiums = conn.execute(
        text(
            "select count(distinct g.stadium_id) from research.nflverse_games g left join research.stadiums s "
            "on s.stadium_id = g.stadium_id where g.stadium_id is not null and s.stadium_id is null"
        )
    ).scalar_one()
    return Counts(
        _by_season(
            conn,
            "select season, count(*) as n from research.nflverse_pbp_plays where season = any(:seasons) group by season",
            by,
        ),
        _by_season(
            conn,
            "select season, count(*) as n from research.nflverse_depth_chart_weeks where season = any(:seasons) group by season",
            by,
        ),
        _by_season(conn, observations, {**by, "source": NGS_SOURCE}),
        _by_season(conn, observations, {**by, "source": PFR_SOURCE}),
        roofs,
        _by_season(
            conn,
            "select season, count(*) as n from research.team_week_observations where source = 'nflverse_kickoff' "
            "and metric = 'implied_team_total' and season = any(:seasons) group by season",
            by,
        ),
        int(stadiums),
        weather,
        round_three_missing(round_three_counts(conn, t.round_three), t.round_three),
    )


def payload(counts: Counts, t: RoundFour, verdict: str | None, built: str | None) -> dict[str, Any]:
    return {
        "plays": dict(counts.plays),
        "charts": dict(counts.charts),
        "ngs": dict(counts.ngs),
        "pfr": dict(counts.pfr),
        "roofs": {s: list(v) for s, v in counts.roofs.items()},
        "figures": dict(counts.figures),
        "stadiums_missing": counts.stadiums_missing,
        "weather_after_the_fill": {s: dict(v) for s, v in counts.weather.items()},
        "depth_chart_verdict": verdict,
        "store_built_under": built,
        "missing": missing_preconditions(counts, t, verdict, built),
    }
