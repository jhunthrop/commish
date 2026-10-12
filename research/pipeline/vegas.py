"""THE MARKET'S PRESEASON WIN TOTALS (`src/projections/vegas/ingest.ts`, the win-totals job,
`scripts/lib/win-totals-csv.ts`).

Two paths into one shape. The committed CSV (`data/win-totals/win-totals.csv`, validated against
the schedule) is the one-time SEED for 2003 onward; the job reads the publisher's own file for the
product season, weekly, until that season kicks off, and writes nothing unless a full league is
posted. Both write three week-one team observations per club under `vegas_win_totals`, stamped
with the publisher's date, then READ THEM BACK and refuse if any did not land as computed (the
insert-or-ignore store would otherwise keep an older, different value in silence).
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Final

from sqlalchemy import Connection, text

from research.errors import ResearchError, SchemaDriftError
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_date_parse, js_is_finite, js_iso, js_number, js_string, js_trim
from research.pipeline.nflverse.csv import parse_csv
from research.pipeline.nflverse.team_eras import nfl_teams_by_season
from research.pipeline.observations import TeamWeekObservation, record_team_observations

VEGAS_SOURCE: Final = "vegas_win_totals"
WIN_TOTALS_CSV_PATH: Final = "data/win-totals/win-totals.csv"
PUBLISHED_WIN_TOTALS_URL: Final = (
    "https://raw.githubusercontent.com/greerreNFL/nfelosrs/main/nfelosrs/Manual%20Data/win_totals.csv"
)
_PUBLISHED_COLUMNS = ("season", "team", "line", "over_odds", "under_odds", "source", "source_date")
_OBSERVATION_WEEK = 1


class VegasMetric:
    WIN_TOTAL = "vegas_win_total"
    OVER_PRICE = "vegas_win_total_over_price"
    UNDER_PRICE = "vegas_win_total_under_price"


@dataclass(frozen=True)
class WinTotalRow:
    season: float
    team: str
    win_total: float
    over_price: float
    under_price: float
    actual_wins: float | None
    source: str
    source_date: str


def _required(raw: str, column: str, season: str, team: str) -> float:
    value = js_number(raw)
    if not js_is_finite(value):
        raise SchemaDriftError(
            f"win-totals.csv row (season {season}, team {team}) has an unreadable {column} (got {json.dumps(raw)})."
        )
    return value


def parse_win_totals_csv(csv_text: str) -> list[WinTotalRow]:
    rows: list[WinTotalRow] = []
    for row in parse_csv(csv_text):
        season_raw, team = row.get("season", ""), row.get("team", "")
        actual = js_trim(row.get("actual_wins", ""))
        rows.append(
            WinTotalRow(
                season=_required(season_raw, "season", season_raw, team),
                team=team,
                win_total=_required(row.get("win_total", ""), "win_total", season_raw, team),
                over_price=_required(row.get("over_price", ""), "over_price", season_raw, team),
                under_price=_required(row.get("under_price", ""), "under_price", season_raw, team),
                actual_wins=None if actual == "" else _required(actual, "actual_wins", season_raw, team),
                source=row.get("source", ""),
                source_date=row.get("source_date", ""),
            )
        )
    return rows


def win_total_observations(rows: Sequence[WinTotalRow]) -> list[TeamWeekObservation]:
    observations: list[TeamWeekObservation] = []
    for row in rows:
        as_of = js_date_parse(row.source_date)
        if as_of is None:
            raise SchemaDriftError(
                f'win-totals.csv row (season {js_string(row.season)}, team {row.team}) has an unparseable source_date "{row.source_date}".'
            )
        for metric, value in (
            (VegasMetric.WIN_TOTAL, row.win_total),
            (VegasMetric.OVER_PRICE, row.over_price),
            (VegasMetric.UNDER_PRICE, row.under_price),
        ):
            observations.append(
                TeamWeekObservation(int(row.season), _OBSERVATION_WEEK, row.team, VEGAS_SOURCE, metric, value, as_of)
            )
    return observations


def normalize_published_team(team: str, season: int) -> str:
    if team == "LAR":
        return "LA"
    if team == "OAK" and season >= 2020:
        return "LV"
    return team


@dataclass(frozen=True)
class PublishedWinTotals:
    posted: bool
    rows: list[WinTotalRow]
    teams_posted: int


def fetch_published_win_totals(fetcher: Fetcher, season: int) -> PublishedWinTotals:
    response = fetcher.get(PUBLISHED_WIN_TOTALS_URL)
    if not response.ok:
        raise ResearchError(f"win-totals publisher returned HTTP {response.status} for {PUBLISHED_WIN_TOTALS_URL}.")
    parsed = parse_csv(response.text())
    if not parsed:
        raise SchemaDriftError("win-totals publisher returned a file with no rows.")
    for column in _PUBLISHED_COLUMNS:
        if column not in parsed[0]:
            raise SchemaDriftError(
                f'win-totals publisher file has no "{column}" column; it carries {", ".join(parsed[0].keys())}.'
            )
    rows = []
    for row in parsed:
        if js_number(row["season"]) != season:
            continue
        team = normalize_published_team(js_trim(row.get("team", "")), season)
        rows.append(
            WinTotalRow(
                season=season,
                team=team,
                win_total=_required(row.get("line", ""), "line", str(season), team),
                over_price=_required(row.get("over_odds", ""), "over_odds", str(season), team),
                under_price=_required(row.get("under_odds", ""), "under_odds", str(season), team),
                actual_wins=None,
                source=js_trim(row.get("source", "")),
                source_date=js_trim(row.get("source_date", "")),
            )
        )
    teams = len({row.team for row in rows})
    return PublishedWinTotals(teams >= len(nfl_teams_by_season(season)), rows, teams)


_READ_BACK = text(
    "select distinct on (week, team, source, metric) season, team, metric, value from team_week_observations "
    "where season = :season and week = :week and as_of <= :as_of and source = :source "
    "order by week asc, team asc, source asc, metric asc, as_of desc"
)


def write_verified_win_totals(conn: Connection, rows: Sequence[WinTotalRow], read_back_as_of: datetime) -> int:
    """`writeVerifiedWinTotals`: write, read back at `read_back_as_of`, refuse on any mismatch."""
    observations = win_total_observations(rows)
    written = record_team_observations(conn, observations)
    stored: dict[str, float] = {}
    for season in sorted({int(row.season) for row in rows}):
        params = {"season": season, "week": _OBSERVATION_WEEK, "as_of": read_back_as_of, "source": VEGAS_SOURCE}
        for r in conn.execute(_READ_BACK, params):
            stored[f"{r.season}|{r.team}|{r.metric}"] = r.value
    mismatches = [
        f"{o.season}|{o.team}|{o.metric}"
        for o in observations
        if stored.get(f"{o.season}|{o.team}|{o.metric}") != o.value
    ]
    if mismatches:
        raise ResearchError(
            f"writeVerifiedWinTotals: {len(mismatches)} observation(s) did not land as computed after the write: "
            + "; ".join(mismatches[:10])
        )
    return written


def ingest_win_totals_csv(conn: Connection, csv_path: Path, now: datetime) -> int:
    """`vegas-win-totals-ingest.ts`: the committed seed, written and verified."""
    return write_verified_win_totals(conn, parse_win_totals_csv(csv_path.read_text(encoding="utf-8")), now)


def run_win_totals(
    conn: Connection, fetcher: Fetcher, season: int, now: datetime, first_kickoff: datetime | None
) -> str:
    """The win-totals job: nothing after kickoff, nothing unless a full league is posted."""
    if first_kickoff is not None and now >= first_kickoff:
        return f"{season} has kicked off, so its preseason lines are settled. Nothing fetched."
    published = fetch_published_win_totals(fetcher, season)
    if not published.posted:
        return f"the publisher has posted {published.teams_posted} team(s) for {season}, not a full league. Nothing written."
    written = write_verified_win_totals(conn, published.rows, now)
    return f"{len(published.rows)} rows read for {season}, {written} new observation(s) written at {js_iso(now)}."
