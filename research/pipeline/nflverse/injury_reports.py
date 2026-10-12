"""THE OFFICIAL INJURY REPORT, as model features (`src/projections/news/retrieve.ts`, `ingestInjuryReports`).

Each designation becomes an ordinal (a larger number is a worse outlook) stamped with the league's
own filing timestamp, the one stamp in the engine not derived from a game's date. An unrecognised
designation is a schema change and throws. A file with no `date_modified` column (2025 onward)
stores nothing for its rows and counts them as unstamped: an unstamped fact cannot be replayed.
"""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import Connection

from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_date_parse, js_is_integer, js_number, js_trim
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import SEASON_TYPE, Releases
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.universe_reads import all_positions
from research.pipeline.observations import PlayerWeekObservation, record_observations

INJURY_SOURCE = "nflverse_injuries"


class InjuryMetric:
    REPORT_STATUS = "injury_report_status"
    PRACTICE_STATUS = "injury_practice_status"


_REPORT_STATUS_BY_NAME = {"": 0, "Note": 0, "Probable": 0, "Questionable": 1, "Doubtful": 2, "Out": 3}
_PRACTICE_STATUS_BY_NAME = {
    "": 0,
    "Full Participation in Practice": 1,
    "Limited Participation in Practice": 2,
    "Did Not Participate In Practice": 3,
}


def _json(raw: str | None) -> str:
    return "undefined" if raw is None else json.dumps(raw)


def _ordinal(raw: str | None, table: dict[str, int], column: str) -> int:
    value = table.get(js_trim(raw or ""))
    if value is None:
        raise SchemaDriftError(
            f"nflverse injuries row has an unrecognised {column} ({_json(raw)}). The published vocabulary changed; "
            'a silent zero here would read as "nobody is hurt".'
        )
    return value


def report_filed_at(date_modified: str | None) -> datetime:
    """`reportFiledAt`: the filing timestamp taken literally, or a refusal."""
    raw = js_trim(date_modified or "")
    filed = None if raw == "" else js_date_parse(raw)
    if filed is None:
        raise SchemaDriftError(
            f"nflverse injuries row has no readable date_modified (got {_json(date_modified)}); an injury report "
            "cannot be stamped, and an unstamped fact cannot be replayed."
        )
    return filed


def has_date_modified_column(rows: Sequence[CsvRow]) -> bool:
    """Decided once per file, from its first row: a CSV's columns are a property of the file."""
    return len(rows) > 0 and "date_modified" in rows[0]


@dataclass(frozen=True)
class InjuryFeatures:
    observations: list[PlayerWeekObservation]
    unknown_players: list[str]
    unstamped: int


def map_injuries(rows: Sequence[CsvRow], projected: frozenset[str] | set[str]) -> InjuryFeatures:
    """`mapInjuries`: both designations for every projected player on the report, zeros included."""
    observations: list[PlayerWeekObservation] = []
    unknown: set[str] = set()
    stamped = has_date_modified_column(rows)
    unstamped = 0
    for row in rows:
        if row.get("game_type") != SEASON_TYPE:
            continue
        player_id = js_trim(row.get("gsis_id") or "")
        if player_id == "":
            continue
        if player_id not in projected:
            unknown.add(player_id)
            continue
        if not stamped:
            unstamped += 1
            continue
        season = js_number(row["season"]) if "season" in row else float("nan")
        week = js_number(row["week"]) if "week" in row else float("nan")
        if not js_is_integer(season) or not js_is_integer(week):
            raise SchemaDriftError(
                f"nflverse injuries row has no readable season/week (got {_json(row.get('season'))}/{_json(row.get('week'))})."
            )
        as_of = report_filed_at(row.get("date_modified"))
        for metric, value in (
            (InjuryMetric.REPORT_STATUS, _ordinal(row.get("report_status"), _REPORT_STATUS_BY_NAME, "report_status")),
            (
                InjuryMetric.PRACTICE_STATUS,
                _ordinal(row.get("practice_status"), _PRACTICE_STATUS_BY_NAME, "practice_status"),
            ),
        ):
            observations.append(
                PlayerWeekObservation(
                    season=int(season),
                    week=int(week),
                    player_id=player_id,
                    source=INJURY_SOURCE,
                    metric=metric,
                    value=float(value),
                    as_of=as_of,
                )
            )
    return InjuryFeatures(observations=observations, unknown_players=sorted(unknown), unstamped=unstamped)


@dataclass(frozen=True)
class NewsIngestReport:
    season: int
    report_rows: int
    observations_written: int
    unknown_players: int
    unstamped: int


def ingest_injury_reports(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> list[NewsIngestReport]:
    """`ingestInjuryReports`: one `injuries_YYYY.csv` per season, narrowed to projected players."""
    projected = frozenset(all_positions(conn))
    reports: list[NewsIngestReport] = []
    for season in seasons:
        rows = client.get_csv(Releases.INJURIES, f"injuries_{season}.csv")
        mapped = map_injuries(rows, projected)
        reports.append(
            NewsIngestReport(
                season=season,
                report_rows=len(rows),
                observations_written=record_observations(conn, mapped.observations),
                unknown_players=len(mapped.unknown_players),
                unstamped=mapped.unstamped,
            )
        )
    return reports
