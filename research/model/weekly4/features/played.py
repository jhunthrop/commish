"""A PLAYED GAME IS A GAME WITH A SNAP (round 4 preregistration, amendment 3).

A player played a game when he took at least one offensive snap in it (`nflverse_snap_counts`,
`offensive_snaps`, of weeks before W at or before t_g, a `box` read as round 3 reads it); he missed
it otherwise. A line with no snap is not a played game, and a snap with no line is one, with no
opportunity of his own. This governs the teammate terms (the vacated rule's "played in one of the
club's last three games", the returning absence and its pre-absence games) and the
`played_in_last_three` column. A snap row carries no club: a played week is placed on his club edge of
that week, else his latest edge before it, else his latest club. A club-game in which no player of the
club has a snap row (the feed's gaps) is left out of the count for every player of the club, and
counted.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime

from sqlalchemy import Connection

from research.model.reads.observations import ObservationQuery, WeekRange, observations_as_of
from research.model.weekly3.ledger import Stamp
from research.model.weekly3.work import PlayerGame
from research.model.weekly4.features.admitted import admit_observations
from research.model.weekly4.features.plays import ZERO_COUNTS, Tallies
from research.model.weekly4.features.shares import GameShare
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric

Snaps = Mapping[str, Mapping[int, float]]  # player -> week -> offensive snaps


def snap_weeks(conn: Connection, season: int, week: int, moment: datetime) -> tuple[dict[str, dict[int, float]], Stamp]:
    """Each player's offensive snaps by week before W, at t_g."""
    rows = (
        observations_as_of(
            conn,
            ObservationQuery(
                season,
                WeekRange(1, week - 1),
                moment,
                NflverseSource.SNAP_COUNTS,
                metrics=(ParticipationMetric.OFFENSIVE_SNAPS,),
            ),
        )
        if week > 1
        else []
    )
    stamp = admit_observations("box", rows, season, week, moment)
    found: dict[str, dict[int, float]] = {}
    for row in rows:
        found.setdefault(row.player_id, {})[row.week] = row.value
    return found, stamp


def _club_of(week: int, edges: Sequence[PlayerGame], latest: str | None) -> str | None:
    before = [g for g in edges if g.week <= week]
    return before[-1].club if before else latest


def played_games(
    snaps: Snaps, edges: Mapping[str, Sequence[PlayerGame]], clubs: Mapping[str, str], tallies: Tallies
) -> dict[str, tuple[GameShare, ...]]:
    """Each player's played games (a snap in each), with his opportunities and his club's."""
    found: dict[str, tuple[GameShare, ...]] = {}
    for pid, weeks in snaps.items():
        own_edges = edges.get(pid, ())
        games: list[GameShare] = []
        for week in sorted(w for w, n in weeks.items() if n > 0):
            club = _club_of(week, own_edges, clubs.get(pid))
            if club is None:
                continue
            tally = tallies.players.get((pid, week))
            own = tally.counts if tally is not None and tally.club == club else ZERO_COUNTS
            snap = next((g.work.snap_share for g in own_edges if g.week == week), 0.0)
            games.append(GameShare(week, club, own, tallies.clubs.get((club, week), ZERO_COUNTS), snap))
        found[pid] = tuple(games)
    return found


def snap_gaps(
    played: Mapping[str, Sequence[GameShare]], club_weeks: Mapping[str, Sequence[int]]
) -> set[tuple[str, int]]:
    """The club-games (club, week) before W in which no player of the club has a snap row."""
    covered = {(g.club, g.week) for games in played.values() for g in games}
    return {(club, w) for club, weeks in club_weeks.items() for w in weeks if (club, w) not in covered}
