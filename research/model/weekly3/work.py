"""A GAME'S WORK: the five opportunity kinds stage 1 predicts, and how a game's rows become them.

Preregistration section 2 item 2: targets, carries, red-zone opportunities (red-zone targets plus
red-zone carries), snap share, and for quarterbacks pass attempts. A player's game is a line-week
(his `player_week_teams` edge, which the store writes once per line). The missing-input table:
a line-week with no `nflverse_pbp_player` row has 0 red-zone opportunities, one with no snap row
has snap share 0, for the stage-1 target and for the means alike; each default is marked on the
game so the results can count it.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, fields
from types import MappingProxyType
from typing import Final, Literal

from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PBP_PLAYER_SOURCE, PbpPlayerMetric
from research.pipeline.observations import PlayerWeekObservation, PlayerWeekTeam

Kind = Literal["targets", "carries", "red_zone", "snap_share", "pass_attempts"]
KINDS: Final[tuple[Kind, ...]] = ("targets", "carries", "red_zone", "snap_share", "pass_attempts")
# Section 2 item 2: 17 lines, QB 5 and RB, WR and TE 4 each (pass attempts for quarterbacks only).
KINDS_BY_POSITION: Final[Mapping[str, tuple[Kind, ...]]] = MappingProxyType(
    {"QB": KINDS, "RB": KINDS[:4], "WR": KINDS[:4], "TE": KINDS[:4]}
)
SNAP_SHARE: Final[Kind] = "snap_share"
PASS_ATTEMPTS: Final[Kind] = "pass_attempts"

# The (source, metric) pairs a game's work is read from.
USAGE_ROWS: Final = (
    (NflverseSource.PLAYER_WEEK, ParticipationMetric.TARGETS),
    (NflverseSource.PLAYER_WEEK, ParticipationMetric.CARRIES),
    (NflverseSource.PLAYER_WEEK, ParticipationMetric.PASS_ATTEMPTS),
    (NflverseSource.SNAP_COUNTS, ParticipationMetric.OFFENSIVE_SNAPS),
    (NflverseSource.SNAP_COUNTS, ParticipationMetric.TEAM_OFFENSIVE_SNAPS),
    (PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_TARGETS),
    (PBP_PLAYER_SOURCE, PbpPlayerMetric.RED_ZONE_CARRIES),
)
USAGE_METRICS: Final = tuple(metric for _, metric in USAGE_ROWS)

# The defaults a game's rows can take (the missing-input table's rows 4 and 5).
NO_RED_ZONE_ROW: Final = "line_week_without_play_by_play_row"
NO_SNAP_ROW: Final = "line_week_without_snap_row"


@dataclass(frozen=True, slots=True)
class Work:
    targets: float
    carries: float
    pass_attempts: float
    snap_share: float
    red_zone: float

    def of(self, kind: Kind) -> float:
        value: float = getattr(self, kind)
        return value

    def with_kind(self, kind: Kind, value: float) -> "Work":
        return Work(*(value if name == kind else getattr(self, name) for name in _FIELDS))


_FIELDS: Final = tuple(f.name for f in fields(Work))  # the constructor's order
ZERO: Final = Work(0.0, 0.0, 0.0, 0.0, 0.0)
ONES: Final = Work(1.0, 1.0, 1.0, 1.0, 1.0)


def mean_work(works: Sequence[Work]) -> Work:
    """The mean of each kind; ZERO for no game (callers mark that default themselves)."""
    if not works:
        return ZERO
    size = len(works)
    return Work(*(sum(getattr(w, name) for w in works) / size for name in _FIELDS))


def sum_work(works: Iterable[Work]) -> Work:
    found = list(works)
    return Work(*(sum(getattr(w, name) for w in found) for name in _FIELDS))


@dataclass(frozen=True, slots=True)
class PlayerGame:
    """One line-week: the week, the club he played for, his work and the defaults it took."""

    week: int
    club: str
    work: Work
    defaults: frozenset[str]


_WANTED: Final = frozenset(USAGE_ROWS)


def _snap_share(values: Mapping[str, float]) -> float | None:
    snaps = values.get(ParticipationMetric.OFFENSIVE_SNAPS)
    team = values.get(ParticipationMetric.TEAM_OFFENSIVE_SNAPS)
    if snaps is None or team is None or team <= 0:
        return None
    return snaps / team


def _game(week: int, club: str, values: Mapping[str, float]) -> PlayerGame:
    share = _snap_share(values)
    rz_targets = values.get(PbpPlayerMetric.RED_ZONE_TARGETS)
    rz_carries = values.get(PbpPlayerMetric.RED_ZONE_CARRIES)
    defaults = set()
    if share is None:
        defaults.add(NO_SNAP_ROW)
    if rz_targets is None and rz_carries is None:
        defaults.add(NO_RED_ZONE_ROW)
    work = Work(
        values.get(ParticipationMetric.TARGETS, 0.0),
        values.get(ParticipationMetric.CARRIES, 0.0),
        values.get(ParticipationMetric.PASS_ATTEMPTS, 0.0),
        0.0 if share is None else share,
        (rz_targets or 0.0) + (rz_carries or 0.0),
    )
    return PlayerGame(week, club, work, frozenset(defaults))


def player_games(
    observations: Sequence[PlayerWeekObservation], edges: Sequence[PlayerWeekTeam]
) -> dict[str, tuple[PlayerGame, ...]]:
    """Each player's line-weeks (his edges) with their work, in week order. A metric read from
    another source than the work's own is ignored."""
    values: dict[tuple[int, str], dict[str, float]] = {}
    for row in observations:
        if (row.source, row.metric) in _WANTED:
            values.setdefault((row.week, row.player_id), {})[row.metric] = row.value
    games: dict[str, list[PlayerGame]] = {}
    for edge in sorted(edges, key=lambda e: (e.player_id, e.week)):
        games.setdefault(edge.player_id, []).append(
            _game(edge.week, edge.team, values.get((edge.week, edge.player_id), {}))
        )
    return {player_id: tuple(found) for player_id, found in games.items()}
