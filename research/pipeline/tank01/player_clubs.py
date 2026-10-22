"""THE PLAYER'S CLUB, FROM THE DAILY LIST (Lane 122): `provider_players.team` kept current.

Until this lane the column was the one-shot seed of early September (`tank01-roster`, the old app's
`seedPlayers`); no job rewrote it, so a player who changed clubs after the seed kept his old club on
the API's card head, its league screens and the draft room, and in the capsules' identities (Lane
120's report, concern 1). The daily player list (`tank01_player_list`, Lane 110) names each listed
player's club now; this is its one writer.

THE RULE. Every player the list carries on a club gets that club on his existing row, in the same
transaction as the list's own snapshot. Nothing is retired and nothing is inserted: the row is the
player's current club, his history stays in the game lines, and seeding a new player stays the
roster seed's job. A player the list carries as a free agent has no club: his row's club becomes NULL
(Lane 123, B101; the list's `team` for a free agent is his last club, not a club he plays for, and
revision 0018 lets the column hold it). A player the list does not carry keeps his row and his club,
and so does a player whose code is not one of the 32. A cleared club counts as a change like any
other, under the same ceiling. Lane 120's page club reads the list through `listed_clubs` too.

THE CEILING. A pass that would change more than `MAX_CLUB_CHANGES_PER_PASS` clubs writes none and
fails its feed, so the job fails and alerts: that many is a provider glitch, not a trade deadline (the
most in any week from 2016 to 2025 was 15, by Lane 120's count against nflverse's weekly rosters). The
operator's one-shot backfill (`backfill_player_clubs`) has no ceiling: it closes the gap since the seed
once, after printing the count.
"""

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.db.schema import PROVIDER_PLAYERS
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS
from research.pipeline.tank01.mapping import listed_as_free_agent

LOG: Final = logging.getLogger(__name__)

MAX_CLUB_CHANGES_PER_PASS: Final = 60
_CLUBS: Final = frozenset(NFL_TEAM_ABBREVIATIONS)


# How a change's log line names a free agent's club, which the store holds as NULL.
FREE_AGENT_LOG_WORDS: Final = "free agent"


def _club_words(club: str | None) -> str:
    return FREE_AGENT_LOG_WORDS if club is None else club


@dataclass(frozen=True)
class ClubChange:
    player_id: str
    name: str
    # None is a free agent's: no club.
    before: str | None
    after: str | None

    def words(self) -> str:
        return f"{self.player_id} {self.name} {_club_words(self.before)} to {_club_words(self.after)}"


@dataclass(frozen=True)
class ClubRefresh:
    """One read's club changes, and whether they were written."""

    changes: tuple[ClubChange, ...]
    applied: bool

    def line(self) -> str:
        count = len(self.changes)
        if self.applied:
            return f"{count} {'club' if count == 1 else 'clubs'} changed"
        return (
            f"refused {count} club changes, more than {MAX_CLUB_CHANGES_PER_PASS} a pass (a provider glitch, "
            "not a trade deadline); every club left as it was"
        )


def listed_clubs(payload: object) -> dict[str, str | None]:
    """Each listed player's club by provider id, None for a free agent (no club, whatever his `team` says);
    a player on a code not among the 32 is left out."""
    if not isinstance(payload, list):
        return {}
    out: dict[str, str | None] = {}
    for raw in payload:
        record = raw if isinstance(raw, dict) else {}
        player_id, club = record.get("playerID"), record.get("team")
        if not isinstance(player_id, str) or not player_id.strip():
            continue
        if listed_as_free_agent(record):
            out[player_id.strip()] = None
        elif isinstance(club, str) and club in _CLUBS:
            out[player_id.strip()] = club
    return out


def club_changes(conn: Connection, clubs: Mapping[str, str | None]) -> tuple[ClubChange, ...]:
    """The stored players whose club the list names otherwise, in id order."""
    if not clubs:
        return ()
    rows = conn.execute(
        text(f'select id, name, team from {PROVIDER_PLAYERS.fullname} where id = any(:ids) order by id collate "C"'),
        {"ids": list(clubs)},
    )
    return tuple(ClubChange(r.id, r.name, r.team, clubs[r.id]) for r in rows if r.team != clubs[r.id])


def _write(conn: Connection, changes: tuple[ClubChange, ...]) -> None:
    if not changes:
        return
    feed = json.dumps([{"id": c.player_id, "team": c.after} for c in changes])
    conn.execute(
        text(
            f"update {PROVIDER_PLAYERS.fullname} as p set team = data.team "
            "from jsonb_to_recordset(cast(:feed as jsonb)) as data(id text, team text) where p.id = data.id"
        ),
        {"feed": feed},
    )


def _apply(conn: Connection, payload: object, limit: int | None) -> ClubRefresh:
    changes = club_changes(conn, listed_clubs(payload))
    if limit is not None and len(changes) > limit:
        LOG.error("player list clubs refused, %d changes: %s", len(changes), "; ".join(c.words() for c in changes))
        return ClubRefresh(changes, applied=False)
    _write(conn, changes)
    if changes:
        LOG.info("player list clubs changed: %s", "; ".join(c.words() for c in changes))
    return ClubRefresh(changes, applied=True)


def refresh_player_clubs(conn: Connection, payload: object) -> ClubRefresh:
    """The capture pass's write: the list's clubs onto the stored rows, refused past the ceiling."""
    return _apply(conn, payload, MAX_CLUB_CHANGES_PER_PASS)


@dataclass(frozen=True)
class ListRead:
    """A stored player list: when it was read, and its body."""

    captured_at: datetime
    payload: object


def backfill_player_clubs(conn: Connection, read: ListRead | None, *, write: bool) -> str:
    """The operator's one-shot (`python -m research.pipeline player-clubs`): the newest stored list's clubs
    onto every stored row, with no ceiling. Its answer opens with the count and names every change; with
    `write` false (`--dry-run`) nothing is written, so the count is seen before the write."""
    if read is None:
        return "no player list read is stored; nothing to apply"
    changes = club_changes(conn, listed_clubs(read.payload))
    if write:
        _write(conn, changes)
    verb = "changed" if write else "would change, dry run, nothing written"
    head = f"{len(changes)} clubs {verb}, from the list read at {read.captured_at.isoformat()}"
    return "\n".join([head, *(f"  {change.words()}" for change in changes)])
