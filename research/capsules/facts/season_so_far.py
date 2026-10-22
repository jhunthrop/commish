"""THIS SEASON SO FAR, ON THE WRITER'S SHEET: the page's own season block, once the season has begun.

The voice a capsule is written in is chosen by the date, never by a flag: before the season's first
kickoff (`model.reads.teams.first_kickoff_for`) a sheet carries no season so far and the writer
speaks to a manager about to draft; from the first kickoff on it carries this block and the writer
speaks to a manager whose draft is done. The block is what the player page prints
(`nightly.build.player_season.season_block`, in the page's format, at the same instant), so the
prose and the page agree on every game, week and point: the weeks behind him (played with their
points, inactive, his bye), the games and points a game, `through`, and the first week his club
played after his current injury status began.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from sqlalchemy import Connection

from research.capsules.facts.model import (
    InjuryStatus,
    InjuryUnknown,
    SeasonSoFar,
    SeasonTotals,
    SeasonWeek,
)
from research.capsules.facts.reference import capture_day
from research.model.domain import Position
from research.model.reads.teams import first_kickoff_for
from research.nightly.build.page_club import call_for, special_teams_week
from research.nightly.build.player_season import SeasonContext, season_block, season_context
from research.nightly.config import PAGE_FORMAT
from research.nightly.reads.schedule import Game

_BEHIND: Final = frozenset({"played", "inactive", "bye"})
_TOUCHDOWNS: Final = ("passing_touchdowns", "rushing_touchdowns", "receiving_touchdowns")


@dataclass(frozen=True, slots=True)
class SeasonSubject:
    """Who a season block is read for: the provider id and position on the board (his club is the
    page's, `nightly.build.page_club`)."""

    player_id: str
    position: Position


def is_in_season(kickoff: datetime | None, as_of: datetime) -> bool:
    """The writer's voice: in season once the season's first kickoff is at or before `as_of`; no
    schedule on file is preseason."""
    return kickoff is not None and kickoff <= as_of


def in_season(conn: Connection, season: int, as_of: datetime) -> bool:
    return is_in_season(first_kickoff_for(conn, season), as_of)


def _touchdowns(totals: Mapping[str, Any]) -> float | None:
    values = [totals[field] for field in _TOUCHDOWNS]
    return None if any(value is None for value in values) else float(sum(values))


def _totals(totals: Mapping[str, Any]) -> SeasonTotals:
    return SeasonTotals(
        totals["carries"],
        totals["rushing_yards"],
        totals["targets"],
        totals["receptions"],
        totals["receiving_yards"],
        totals["passing_yards"],
        _touchdowns(totals),
        totals["points"],
    )


def _weeks(log: Sequence[Mapping[str, Any]], through: int) -> tuple[SeasonWeek, ...]:
    """The weeks behind him: every week through `through`, and a week he has already played past it."""
    return tuple(
        SeasonWeek(row["week"], row["status"], row["points"])
        for row in log
        if row["status"] in _BEHIND and (row["week"] <= through or row["status"] == "played")
    )


def injury_from_week(injury: InjuryStatus, slate: Sequence[Game]) -> int | None:
    """The first week his club played on or after the Eastern day his injury status began."""
    if isinstance(injury, InjuryUnknown):
        return None
    weeks = [game.week for game in slate if capture_day(game.kickoff) >= injury.since]
    return min(weeks) if weeks else None


def season_so_far(subject: SeasonSubject, injury: InjuryStatus, context: SeasonContext) -> SeasonSoFar:
    """One player's block as the page prints it, on the writer's sheet."""
    block = season_block(subject.player_id, PAGE_FORMAT, subject.position, context)
    call = call_for(context.clubs, subject.player_id)
    club = call.club
    return SeasonSoFar(
        block["season"],
        block["through"],
        block["games"],
        block["pointsPerGame"],
        _totals(block["totals"]),
        _weeks(block["log"], block["through"]),
        injury_from_week(injury, () if club is None else context.games.get(club, ())),
        special_teams_week(call, block["log"]),
    )


def seasons_so_far(
    conn: Connection,
    season: int,
    as_of: datetime,
    subjects: Sequence[SeasonSubject],
    injuries: Mapping[str, InjuryStatus],
) -> dict[str, SeasonSoFar]:
    """Every subject's season so far by provider id; none at all before the first kickoff."""
    if not subjects or not in_season(conn, season, as_of):
        return {}
    context = season_context(conn, season, [s.player_id for s in subjects], as_of)
    return {
        s.player_id: season_so_far(s, injuries.get(s.player_id, InjuryUnknown("unknown")), context) for s in subjects
    }
