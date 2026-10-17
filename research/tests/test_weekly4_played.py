# ruff: noqa: PLR2004 - the expected values are hand-computed from the games written beside them
"""A played game is a game with an offensive snap (round 4 amendment 3): a backup who took snaps and
had no line is not away; a player with a line and no snap is away; a club-game with no snap rows at
all is left out of the count for every player of the club, and counted."""

from dataclasses import replace
from datetime import UTC, datetime

from research.model.weekly3.work import PlayerGame, Work
from research.model.weekly4.features.played import played_games, snap_gaps
from research.model.weekly4.features.plays import Counts, PlayerTally, Tallies
from research.model.weekly4.features.teammates import Teammates, returning, vacated

_AT = datetime(2023, 10, 1, tzinfo=UTC)
_TEAM = Counts(targets=10.0, carries=20.0, dropbacks=30.0)


def _tallies() -> Tallies:
    clubs = {("KC", w): _TEAM for w in (1, 2, 3, 4, 5)}
    players = {("starter", w): PlayerTally("KC", Counts(targets=5.0)) for w in (1, 2)}
    return Tallies(players, clubs, {}, {})


def _edge(week: int, targets: float = 0.0) -> PlayerGame:
    return PlayerGame(week, "KC", Work(targets, 0.0, 0.0, 0.5, 0.0), frozenset())


def test_a_backup_with_snaps_and_no_line_played_and_a_line_with_no_snap_did_not() -> None:
    snaps = {
        "backup": {3: 12.0, 4: 9.0, 5: 4.0},  # snaps in the club's last three games, never a line
        "starter": {1: 60.0, 2: 58.0, 3: 0.0},  # a line in week 3 with zero snaps: he missed it
        "filler": {1: 20.0},
    }
    edges = {"backup": (_edge(1),), "starter": (_edge(1, 5.0), _edge(2, 5.0), _edge(3)), "filler": (_edge(1),)}
    played = played_games(snaps, edges, {"backup": "KC", "starter": "KC", "filler": "KC"}, _tallies())
    assert [g.week for g in played["backup"]] == [3, 4, 5]
    assert [g.week for g in played["starter"]] == [1, 2]
    assert played["backup"][0].own == Counts()  # a snap with no line: a played game with no touch
    mates = Teammates(
        club="KC",
        recent_weeks=(3, 4, 5),
        histories=played,
        clubs={"backup": "KC", "starter": "KC", "me": "KC"},
        statuses={"backup": "questionable", "starter": "questionable"},
        depth=frozenset({"backup", "starter"}),
    )
    back = returning("me", mates)
    assert back.counted == 1  # the starter, away since week 3; the backup played every week
    assert back.shares.targets == 0.5  # the starter's per-game shares before the absence: 5 of 10
    assert vacated("me", replace(mates, statuses={"backup": "withheld"})).counted == 1  # he played in the last three
    assert vacated("me", replace(mates, statuses={"starter": "withheld"})).left_out == 1  # he did not


def test_a_club_game_with_no_snap_rows_is_skipped_and_counted() -> None:
    snaps = {"a": {1: 30.0, 2: 31.0}, "b": {1: 10.0}}
    played = played_games(snaps, {"a": (_edge(1), _edge(2)), "b": (_edge(1),)}, {"a": "KC", "b": "KC"}, _tallies())
    gaps = snap_gaps(played, {"KC": (1, 2, 3)})
    assert gaps == {("KC", 3)}  # nobody of the club has a snap row in week 3
    mates = Teammates(
        club="KC",
        recent_weeks=tuple(w for w in (1, 2, 3) if ("KC", w) not in gaps),
        histories=played,
        clubs={"a": "KC", "b": "KC", "me": "KC"},
        statuses={"b": "questionable"},
        depth=frozenset({"b"}),
    )
    assert returning("me", mates).counted == 1  # b missed week 2, the latest game with snap rows
