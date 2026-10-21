"""THE CLUB A PAGE NAMES (Lane 120, B100): one rule for the page, the board row, the rest of season and
the week's read.

Where the club came from before: `provider_players.team`, the provider's roster as the one-shot legacy
copy left it (the old app's seed, early September). No job rewrites it, so a player who moved after the
seed kept his old club on every page. The provider's own list is read each day (`tank01_player_list`,
Lane 110, in `capture_snapshots`) and names his club now; the game lines (`player_week_teams`) name the
club he played each week for.

THE RULE. His club is the club on the newest player list read at or before the run. When his newest
game line names another club, the line wins unless the read is at least `LIST_CATCH_UP` newer than
that game's kickoff: the provider's roster refresh lands within a day, so a read sooner than that may
not have caught up with the move (Lane 120 fix round 1, review M1). A free agent on the list has no club
(Lane 123, B101) by the same rule: his newest line's club wins only when the read is not that much newer
than its game. With no list read, or the list not naming him, his newest line's club; with no line
either, the seeded roster's, which is NULL for a free agent (`provider_players.team`, revision 0018): no
club.
The page says which club his newest line was for only when that is not the page's club
(`latest_club`), which happens only when a list read well after his last game moved him.

THE WEEKS WITH NO LINE. A player is a mover when the season's facts (the seeded roster, the list read,
his lines) name more than one club. A mover's week with no line, up to his newest line's week, names no
opponent: the run holds no fact of which club he was with. His weeks after it are the page club's.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection, text

from research.model.instants import ms_instant
from research.nightly.reads.board import FormatBoard
from research.nightly.reads.schedule import Game
from research.pipeline.tank01.capture import PLAYER_LIST_SOURCE
from research.pipeline.tank01.player_clubs import listed_clubs

# How much newer than a game's kickoff a list read must be to win over that game's line: the provider's
# roster refresh lands within a day, with half a day's margin (the coordinator's ruling, review M1).
LIST_CATCH_UP: Final = timedelta(hours=36)


@dataclass(frozen=True, slots=True)
class RosterRead:
    """The newest player list at the run: each listed player's club by provider id (None for a free agent),
    and when it was read."""

    clubs: Mapping[str, str | None]
    read_at: datetime | None


NO_ROSTER_READ: Final = RosterRead(MappingProxyType({}), None)


def read_roster(conn: Connection, as_of: datetime) -> RosterRead:
    """The newest player list read at or before `as_of`; none before the list was first read."""
    row = conn.execute(
        text(
            "select captured_at, payload from research.capture_snapshots where source = :source "
            "and captured_at <= :as_of order by captured_at desc, id desc limit 1"
        ),
        {"source": PLAYER_LIST_SOURCE, "as_of": as_of},
    ).first()
    if row is None:
        return NO_ROSTER_READ
    return RosterRead(MappingProxyType(listed_clubs(row.payload)), ms_instant(row.captured_at))


def seeded_clubs(conn: Connection, player_ids: Sequence[str]) -> dict[str, str | None]:
    """Each player's club on the stored roster (`provider_players.team`), None for a free agent."""
    rows = conn.execute(
        text("select id, team from research.provider_players where id = any(:ids)"), {"ids": list(player_ids)}
    )
    return {row.id: row.team for row in rows}


@dataclass(frozen=True, slots=True)
class ClubCall:
    """His club as the page names it (None: a free agent, no club), his newest game line's week and club,
    and whether he moved."""

    club: str | None
    latest_week: int | None
    latest_club: str | None
    moved: bool

    @property
    def line_elsewhere(self) -> bool:
        """His newest game line was for another club than the page's."""
        return self.latest_club is not None and self.latest_club != self.club

    def club_in(self, week: int, through: int) -> str | None:
        """The club whose game a week with no line of his is: none for a mover up to his newest line
        (a week the records have reached), else the page club (none for a free agent)."""
        unknown = self.moved and self.latest_week is not None and week <= min(self.latest_week, through)
        return None if unknown else self.club


def _kickoff(games: Mapping[str, Sequence[Game]], club: str, week: int) -> datetime | None:
    return next((game.kickoff for game in games.get(club, ()) if game.week == week), None)


def club_call(
    seeded: str | None,
    roster: RosterRead,
    player_id: str,
    lines: Mapping[int, str],
    games: Mapping[str, Sequence[Game]],
) -> ClubCall:
    """THE RULE (module doc) for one player: `lines` is his club by week from his game lines."""
    on_list = player_id in roster.clubs
    listed = roster.clubs.get(player_id)
    latest_week = max(lines, default=None)
    latest_club = None if latest_week is None else lines[latest_week]
    club: str | None
    if not on_list:
        club = latest_club or seeded
    elif latest_club is None or latest_club == listed or latest_week is None:
        club = listed
    else:
        # A line whose game the schedule does not hold is taken as the newer fact.
        kickoff = _kickoff(games, latest_club, latest_week)
        newer = roster.read_at is None or kickoff is None or roster.read_at < kickoff + LIST_CATCH_UP
        club = latest_club if newer else listed
    named = {named_club for named_club in (seeded, *lines.values(), listed) if named_club is not None}
    return ClubCall(club, latest_week, latest_club, len(named) > 1)


def club_calls(
    seeded: Mapping[str, str | None],
    roster: RosterRead,
    teams: Mapping[str, Mapping[int, str]],
    games: Mapping[str, Sequence[Game]],
) -> dict[str, ClubCall]:
    """Every seeded player's call."""
    return {pid: club_call(club, roster, pid, teams.get(pid, {}), games) for pid, club in seeded.items()}


def call_for(calls: Mapping[str, ClubCall], player_id: str) -> ClubCall:
    found = calls.get(player_id)
    if found is None:
        raise ValueError(f"{player_id} has no club call: the season context was not read for him")
    return found


def with_page_clubs(board: FormatBoard, calls: Mapping[str, ClubCall]) -> FormatBoard:
    """The board with each row's club the page's."""
    entries = tuple(replace(e, row=replace(e.row, team=call_for(calls, e.row.player_id).club)) for e in board.entries)
    return replace(board, entries=entries)


def last_game_club(call: ClubCall) -> dict[str, Any] | None:
    """The page's `lastGameClub`: his newest line's club and week when it is not the page club, else None."""
    if not call.line_elsewhere or call.latest_week is None:
        return None
    return {"club": call.latest_club, "week": call.latest_week}
