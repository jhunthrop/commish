"""THE REST-OF-SEASON MODEL IN THE NIGHTLY: the judged round-3 model (`commish_ros_v3`) read from its
pinned artifact, never fit here, applied to the product season once the switch week is reached.

What ships (founder ruling 2026-10-14, "ship"; the coordinator's step-4 rulings): from the switch
week the boards rank by the model's rest-of-season points, ordering only, no interval. Before it, or
whenever an input is missing (the artifact, the season's lines, a week still to play), the board is
the preseason board as today, and the run's report says why.

Two reads, both here: the artifact (one row), and the raw board's points a game for the season's
served raw generation (one statement, kept by the read cache). The season so far comes from the
store the player pages already read (`nightly.build.player_season.SeasonStore`), so the switch adds
no read of the season's lines. Everything else is the model's own arithmetic (`model.py`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.artifacts import MissingArtifactError, read_artifact
from research.model.domain import Position, ScoringRules, StatLine, compute_fantasy_points
from research.model.ros.model import (
    FORMATS,
    LAST_FANTASY_WEEK,
    SEASON_GAMES,
    GamePlayed,
    PlayerToDate,
    RosPriors,
    StaleEntry,
)
from research.model.ros.payload import ARTIFACT_NAME, priors_from

ARTIFACT_VERSION: Final = 1
RAW_SOURCE: Final = "commish_board_v1_ppr_12"
# The first week the model's board is served (the coordinator's step-4 ruling, 2026-10-14: "the first
# in-season week with the model is week 6"). Round 3's preregistration had the preseason board through
# week 6; this ships the model a week earlier, at a week no round judged (concern named in the report).
FIRST_MODEL_WEEK: Final = 6
_STAT_FIELDS: Final = (
    "passing_yards", "passing_touchdowns", "interceptions", "rushing_yards", "rushing_touchdowns",
    "receiving_yards", "receiving_touchdowns", "receptions", "fumbles_lost", "field_goals_made",
    "extra_points_made", "sacks", "defensive_interceptions", "defensive_touchdowns",
)  # fmt: skip
_USAGE_INGEST: Final = frozenset(
    {"carries", "targets", "pass_attempts", "team_carries", "team_targets", "team_pass_attempts"}
)


def load_ros_priors(conn: Connection, version: int = ARTIFACT_VERSION) -> RosPriors | None:
    """The judged model's fitted numbers, or None when the store does not hold the artifact."""
    try:
        return priors_from(read_artifact(conn, ARTIFACT_NAME, version).payload)
    except MissingArtifactError:
        return None


@dataclass(frozen=True, slots=True)
class RawPrior:
    """The raw board's season points (PPR) and expected games for one player, by universe id."""

    player_id: str
    projected: float
    expected_games: float


_RAW_PRIORS: Final = text(
    "select player_id, projected_points, expected_games from research.preseason_projections "
    "where season = :s and source = :source and as_of = ("
    "select max(as_of) from research.preseason_projections where season = :s and source = :source and as_of <= :a"
    ") order by player_id"
)


def raw_priors(conn: Connection, season: int, as_of: datetime) -> tuple[RawPrior, ...]:
    """The newest raw generation at or before `as_of`: one statement, cacheable (no side effect)."""
    rows = conn.execute(_RAW_PRIORS, {"s": season, "source": RAW_SOURCE, "a": as_of})
    return tuple(RawPrior(r.player_id, float(r.projected_points), float(r.expected_games)) for r in rows)


@dataclass(frozen=True, slots=True)
class Window:
    """The rest of the season the board ranks: from `from_week`, with lines through `through`."""

    from_week: int
    through: int


def window_of(pending_weeks: Sequence[int], through: int) -> Window | str:
    """The window, or why the board stays preseason. `pending_weeks` are the weeks with a game still
    to kick off at the run instant (from the stored schedule); `through` the last week whose games
    are all in the records."""
    if not pending_weeks:
        return "the season's schedule has no game left to play"
    from_week = min(pending_weeks)
    if from_week < FIRST_MODEL_WEEK:
        return f"week {from_week} is before the switch week ({FIRST_MODEL_WEEK})"
    if from_week > LAST_FANTASY_WEEK:
        return f"week {from_week} is past week {LAST_FANTASY_WEEK}, the last the model ranks"
    if through < 1:
        return "the store holds no week of this season's lines"
    return Window(from_week, min(through, from_week - 1))


def _points(metrics: Mapping[str, float], position: Position, rules: ScoringRules) -> float:
    line = StatLine("", 0).with_values(**{field: metrics.get(field, 0.0) for field in _STAT_FIELDS})
    return compute_fantasy_points(line, position, rules)


@dataclass(frozen=True, slots=True)
class WeekFacts:
    """One week of the season store for one player: the stat source's metrics and his snaps."""

    metrics: Mapping[str, float]
    snaps: Mapping[str, float]


def game_played(
    week: int, facts: WeekFacts, position: Position, rules: Mapping[str, ScoringRules]
) -> GamePlayed | None:
    """The week as the model reads it, or None when he did not play: a stat line, or offensive snaps
    with no stat (the round's rule: a published line or snaps)."""
    stats = any(metric not in _USAGE_INGEST for metric in facts.metrics)
    snaps = facts.snaps.get("offensive_snaps", 0.0)
    if not stats and snaps <= 0:
        return None
    team = facts.snaps.get("team_offensive_snaps", 0.0)
    return GamePlayed(
        week,
        {name: _points(facts.metrics, position, rules[name]) if stats else 0.0 for name in FORMATS},
        facts.metrics.get("targets", 0.0),
        facts.metrics.get("carries", 0.0),
        facts.metrics.get("pass_attempts", 0.0),
        snaps / team if team > 0 else 0.0,
    )


def stale_prior(raw: RawPrior | None, served_projected: Mapping[str, float], served_games: float) -> StaleEntry:
    """The model's prior for one player: the raw board's PPR points a game, carried to half PPR and
    standard by the served boards' own ratio to PPR (the raw line's format split is not stored), and
    the served board's expected games as availability. No raw row: the off-board rate stands in."""
    ppr = served_projected["ppr"]
    ratios = {name: served_projected[name] / ppr if ppr > 0 else 1.0 for name in FORMATS}
    per_game = (
        None
        if raw is None or raw.expected_games <= 0
        else {name: raw.projected / raw.expected_games * ratios[name] for name in FORMATS}
    )
    return StaleEntry(dict(served_projected), per_game, min(1.0, served_games / SEASON_GAMES))


@dataclass(frozen=True, slots=True)
class PlayerWeeks:
    """What the season store says of one player: his club by week and each week's facts."""

    player_id: str
    position: Position
    club: str  # the served board's club, when the season store has no week for him
    clubs: Mapping[int, str]
    weeks: Mapping[int, WeekFacts]


def player_to_date(
    who: PlayerWeeks,
    window: Window,
    schedule: Mapping[str, Sequence[int]],
    stale: StaleEntry,
    rules: Mapping[str, ScoringRules],
) -> PlayerToDate:
    """The model's input at the window: games through `through`, his club's games from `from_week`."""
    known = [week for week in who.clubs if week <= window.through]
    club = who.clubs[max(known)] if known else who.club
    weeks = schedule.get(club, ())
    played = []
    for week in sorted(w for w in who.weeks if w <= window.through):
        game = game_played(week, who.weeks[week], who.position, rules)
        if game is not None:
            played.append(game)
    return PlayerToDate(
        who.player_id,
        who.position,
        tuple(sorted(w for w in weeks if w <= window.through)),
        tuple(played),
        tuple(sorted(w for w in weeks if window.from_week <= w <= LAST_FANTASY_WEEK)),
        stale,
    )
