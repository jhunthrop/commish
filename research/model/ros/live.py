"""THE REST-OF-SEASON MODEL IN THE NIGHTLY: the judged round-3 model (`commish_ros_v3`) read from its
pinned artifact, never fit here, applied to the product season once the switch week is reached.

What ships (founder ruling 2026-10-14, "ship"; the coordinator's step-4 rulings): from the switch
week the boards rank by the model's rest-of-season points, ordering only, no interval. Before it, or
whenever an input is missing (the artifact, the season's lines, a week still to play), the board is
the preseason board as today, and the run's report says why.

Three reads, all here or in `raw_line`: the artifact (one row), the raw board's line kept by the fit
step (one row, through the read cache), and the season's players with a line (one statement, so a
player off the preseason board is ranked too, as the judged universe ranked him). The season so far
comes from the store the player pages already read (`nightly.build.player_season`); everything else is
the model's own arithmetic (`model.py`).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.artifacts import MissingArtifactError, read_artifact
from research.model.domain import Position, ScoringRules, StatLine, compute_fantasy_points
from research.model.reads.observations import STAT_LINE_SOURCE
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
from research.model.weekly.round.scoring import SKILL_POSITIONS

ARTIFACT_VERSION: Final = 1
# The first week the model's board is served: round 3's preregistration, the preseason board through
# the switch week (6) and the model from week 7 (the coordinator's ruling of 2026-10-14: "the record wins").
FIRST_MODEL_WEEK: Final = 7
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
class SeasonPlayer:
    """A player with a stat line this season, as the product names him (the judged universe takes
    every such player, on the preseason board or not)."""

    universe_id: str
    provider_id: str
    name: str
    position: Position
    team: str
    headshot_url: str | None
    market_adp: float | None


_SEASON_PLAYERS: Final = text(
    "select distinct on (pp.id) o.player_id, pp.id, pp.name, pp.position, pp.team, pp.headshot_url, pp.adp "
    "from research.player_week_observations o "
    "join research.player_crosswalk c on c.player_id = o.player_id "
    "join research.provider_players pp on pp.id = c.provider_player_id "
    "where o.season = :s and o.source = :source and o.as_of <= :a and pp.position = any(:positions) "
    "order by pp.id, o.player_id"
)


def season_players(conn: Connection, season: int, as_of: datetime) -> tuple[SeasonPlayer, ...]:
    """Every QB, RB, WR and TE with a published line this season at `as_of`: one statement."""
    rows = conn.execute(
        _SEASON_PLAYERS, {"s": season, "source": STAT_LINE_SOURCE, "a": as_of, "positions": list(SKILL_POSITIONS)}
    )
    return tuple(SeasonPlayer(r.player_id, r.id, r.name, r.position, r.team, r.headshot_url, r.adp) for r in rows)


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


def stale_prior(
    raw_per_game: Mapping[str, float] | None, served_projected: Mapping[str, float], served_games: float
) -> StaleEntry:
    """The model's prior for one player on the preseason board, as judged: the raw board's line scored
    in each format over its expected games (`raw_line`), and the served board's expected games as
    availability. A player the raw line lacks takes the off-board rate (`per_game` None)."""
    per_game = None if raw_per_game is None else dict(raw_per_game)
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
    stale: StaleEntry | None,
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
