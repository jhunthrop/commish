"""THE POINT-IN-TIME READS OF PLAYER FACTS: observations, stat lines and usage, as of an instant.

Ported from `research-ts/src/projections/{store,lines,usage}.ts`. The SQL is the oracle's own
(`DISTINCT ON` the fact, the latest `as_of` at or before the instant), in the oracle's own order,
because the order rows arrive in is the order the model's maps are filled in, and a sum over a
map is only reproducible in one order.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Final

from sqlalchemy import Connection, text

from research.model.domain import STAT_FIELDS, Position, StatLine, camel_to_snake
from research.model.instants import ms_instant
from research.pipeline.nflverse.participation import NflverseSource, ParticipationMetric
from research.pipeline.nflverse.pbp import PbpPlayerMetric
from research.pipeline.observations import LAST_POSSIBLE_WEEK, PlayerWeekObservation

__all__ = ["LAST_POSSIBLE_WEEK"]

STAT_LINE_SOURCE: Final = NflverseSource.PLAYER_WEEK


@dataclass(frozen=True, slots=True)
class WeekRange:
    first: int
    last: int


Weeks = int | WeekRange


@dataclass(frozen=True, slots=True)
class ObservationQuery:
    season: int
    week: Weeks
    as_of: datetime
    source: str | None = None


def _week_bounds(week: Weeks) -> tuple[int, int]:
    return (week, week) if isinstance(week, int) else (week.first, week.last)


_OBSERVATIONS_AS_OF: Final = """
select distinct on (week, player_id, source, metric) season, week, player_id, source, metric, value, as_of
from research.player_week_observations
where season = :season and week >= :first and week <= :last and as_of <= :as_of {source}
order by week asc, player_id asc, source asc, metric asc, as_of desc
"""


def observations_as_of(conn: Connection, query: ObservationQuery) -> list[PlayerWeekObservation]:
    """`observationsAsOf`."""
    first, last = _week_bounds(query.week)
    params: dict[str, object] = {"season": query.season, "first": first, "last": last, "as_of": query.as_of}
    clause = ""
    if query.source is not None:
        clause = "and source = :source"
        params["source"] = query.source
    rows = conn.execute(text(_OBSERVATIONS_AS_OF.format(source=clause)), params)
    return [
        PlayerWeekObservation(
            row.season, row.week, row.player_id, row.source, row.metric, row.value, ms_instant(row.as_of)
        )
        for row in rows
    ]


def stat_metric_name(field: str) -> str:
    """`statMetricName`: the camelCase field's snake_case metric (`passingYards` -> `passing_yards`)."""
    return camel_to_snake(field)


@dataclass(frozen=True, slots=True)
class SeasonStatLine:
    season: int
    line: StatLine
    as_of: datetime


_FIELD_BY_METRIC: Final = frozenset(STAT_FIELDS)


def stat_lines_from(observations: Sequence[PlayerWeekObservation]) -> list[SeasonStatLine]:
    """The fold `statLinesAsOf` makes of its observations: one line per (week, player), first-seen
    order, every unknown metric ignored."""
    lines: dict[str, SeasonStatLine] = {}
    for observation in observations:
        field = observation.metric
        if field not in _FIELD_BY_METRIC:
            continue
        key = f"{observation.week}|{observation.player_id}"
        existing = lines.get(key)
        if existing is None:
            line = StatLine(observation.player_id, observation.week).with_values(**{field: observation.value})
            lines[key] = SeasonStatLine(observation.season, line, observation.as_of)
            continue
        as_of = observation.as_of if observation.as_of > existing.as_of else existing.as_of
        lines[key] = SeasonStatLine(existing.season, existing.line.with_values(**{field: observation.value}), as_of)
    return list(lines.values())


def stat_lines_as_of(conn: Connection, query: ObservationQuery, source: str = STAT_LINE_SOURCE) -> list[SeasonStatLine]:
    """`statLinesAsOf`."""
    return stat_lines_from(observations_as_of(conn, replace(query, source=source)))


@dataclass(frozen=True, slots=True)
class PlayerWeekTouches:
    carries: float
    targets: float
    red_zone_carries: float
    red_zone_targets: float
    inside_ten_carries: float
    inside_ten_targets: float
    air_yards: float
    air_yard_targets: float


@dataclass(frozen=True, slots=True)
class PlayerWeekUsage:
    season: int
    week: int
    player_id: str
    snap_share: float | None
    target_share: float | None
    carry_share: float | None
    pass_attempt_share: float | None
    targets: float | None
    carries: float | None
    pass_attempts: float | None
    team_targets: float | None
    team_carries: float | None
    team_pass_attempts: float | None
    touches: PlayerWeekTouches | None
    as_of: datetime


_USAGE_METRICS: Final = (
    ParticipationMetric.OFFENSIVE_SNAPS,
    ParticipationMetric.TEAM_OFFENSIVE_SNAPS,
    ParticipationMetric.TARGETS,
    ParticipationMetric.TEAM_TARGETS,
    ParticipationMetric.CARRIES,
    ParticipationMetric.TEAM_CARRIES,
    ParticipationMetric.PASS_ATTEMPTS,
    ParticipationMetric.TEAM_PASS_ATTEMPTS,
)
_TOUCH_METRICS: Final = (
    PbpPlayerMetric.CARRIES,
    PbpPlayerMetric.TARGETS,
    PbpPlayerMetric.RED_ZONE_CARRIES,
    PbpPlayerMetric.RED_ZONE_TARGETS,
    PbpPlayerMetric.INSIDE_TEN_CARRIES,
    PbpPlayerMetric.INSIDE_TEN_TARGETS,
    PbpPlayerMetric.AIR_YARDS,
    PbpPlayerMetric.AIR_YARD_TARGETS,
)
_USAGE_METRIC_SET: Final = frozenset((*_USAGE_METRICS, *_TOUCH_METRICS))


class ShareError(ValueError):
    """A part larger than its whole, or a value that is not a finite non-negative number."""


def share(part: float, whole: float, part_label: str, whole_label: str) -> float | None:
    """`share` (`features/opportunity.ts`)."""
    for value, label in ((part, part_label), (whole, whole_label)):
        if value != value or value in (float("inf"), float("-inf")):
            raise ShareError(f"{label} must be a finite number; got {value}.")
        if value < 0:
            raise ShareError(f"{label} must not be negative; got {value}.")
    if whole == 0:
        return None
    if part > whole:
        raise ShareError(
            f"{part_label} ({part}) is more than {whole_label} ({whole}); the two numbers describe different players or different weeks."
        )
    return part / whole


def _share_or_none(part: float | None, whole: float | None, labels: tuple[str, str]) -> float | None:
    return None if part is None or whole is None else share(part, whole, *labels)


def _touches_of(metrics: dict[str, float]) -> PlayerWeekTouches | None:
    if PbpPlayerMetric.CARRIES not in metrics:
        return None
    missing = [metric for metric in _TOUCH_METRICS if metric not in metrics]
    if missing:
        raise ValueError(
            f"A play-by-play touch row carries {PbpPlayerMetric.CARRIES} but not {missing[0]}; the group is written all-or-nothing and a zero here would invent a fact about where this player's touches came from."
        )
    return PlayerWeekTouches(*(metrics[metric] for metric in _TOUCH_METRICS))


@dataclass(slots=True)
class _UsageEntry:
    season: int
    week: int
    player_id: str
    as_of: datetime
    metrics: dict[str, float]


def usage_from(observations: Sequence[PlayerWeekObservation]) -> list[PlayerWeekUsage]:
    """The fold `usageAsOf` makes of its observations."""
    values: dict[str, _UsageEntry] = {}
    for observation in observations:
        if observation.metric not in _USAGE_METRIC_SET:
            continue
        key = f"{observation.week}|{observation.player_id}"
        existing = values.get(key)
        if existing is None:
            values[key] = _UsageEntry(
                observation.season,
                observation.week,
                observation.player_id,
                observation.as_of,
                {observation.metric: observation.value},
            )
            continue
        existing.metrics[observation.metric] = observation.value
        existing.as_of = max(existing.as_of, observation.as_of)
    rows: list[PlayerWeekUsage] = []
    for entry in values.values():
        team_snaps = entry.metrics.get(ParticipationMetric.TEAM_OFFENSIVE_SNAPS)
        if team_snaps is None:
            continue
        at = entry.metrics.get
        snaps = at(ParticipationMetric.OFFENSIVE_SNAPS)
        targets = at(ParticipationMetric.TARGETS)
        carries = at(ParticipationMetric.CARRIES)
        pass_attempts = at(ParticipationMetric.PASS_ATTEMPTS)
        team_targets = at(ParticipationMetric.TEAM_TARGETS)
        team_carries = at(ParticipationMetric.TEAM_CARRIES)
        team_pass_attempts = at(ParticipationMetric.TEAM_PASS_ATTEMPTS)
        rows.append(
            PlayerWeekUsage(
                season=entry.season,
                week=entry.week,
                player_id=entry.player_id,
                snap_share=_share_or_none(snaps, team_snaps, ("player snaps", "team offensive snaps")),
                target_share=_share_or_none(targets, team_targets, ("player targets", "team targets")),
                carry_share=_share_or_none(carries, team_carries, ("player carries", "team carries")),
                pass_attempt_share=_share_or_none(
                    pass_attempts, team_pass_attempts, ("player pass attempts", "team pass attempts")
                ),
                targets=targets,
                carries=carries,
                pass_attempts=pass_attempts,
                team_targets=team_targets,
                team_carries=team_carries,
                team_pass_attempts=team_pass_attempts,
                touches=_touches_of(entry.metrics),
                as_of=entry.as_of,
            )
        )
    return rows


def usage_as_of(conn: Connection, query: ObservationQuery) -> list[PlayerWeekUsage]:
    """`usageAsOf`: every metric of every source at the instant, folded per (week, player)."""
    return usage_from(observations_as_of(conn, replace(query, source=None)))


def admit_touches_as_opportunity(
    rows: Sequence[PlayerWeekUsage], positions: dict[str, Position]
) -> list[PlayerWeekUsage]:
    """`admitTouchesAsOpportunity`: the play-by-play's touch counts stand in for missing counts."""
    admitted: list[PlayerWeekUsage] = []
    for row in rows:
        if row.touches is None:
            admitted.append(row)
            continue
        targets = row.targets if row.targets is not None else row.touches.targets
        carries = row.carries
        if carries is None:
            carries = None if positions.get(row.player_id) == "QB" else row.touches.carries
        if targets == row.targets and carries == row.carries:
            admitted.append(row)
        else:
            admitted.append(replace(row, targets=targets, carries=carries))
    return admitted


def season_span(season: int, as_of: datetime) -> ObservationQuery:
    """A whole season's weeks at an instant (`{ season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf }`)."""
    return ObservationQuery(season, WeekRange(1, LAST_POSSIBLE_WEEK), as_of)


# --- the gap seasons' derived lines (`nflverse/derived-stat-lines.ts`) ---------------------------

DERIVED_STAT_LINE_SOURCE: Final = "nflverse_pbp_derived"
STAT_LINE_GAPS: Final = (2019, 2025)
LIVE_ADMITTED_DERIVED_SEASONS: Final = (2025,)


def stat_lines_for_measurement(conn: Connection, query: ObservationQuery) -> list[SeasonStatLine]:
    """`statLinesAsOfForMeasurement`: the published lines, filled from play-by-play in a gap season."""
    published = stat_lines_as_of(conn, query, STAT_LINE_SOURCE)
    if query.season not in STAT_LINE_GAPS:
        return published
    derived = stat_lines_as_of(conn, query, DERIVED_STAT_LINE_SOURCE)
    keys = {f"{row.line.week}|{row.line.player_id}" for row in published}
    return [*published, *(row for row in derived if f"{row.line.week}|{row.line.player_id}" not in keys)]


def admits_derived_for_live_surface(season: int) -> bool:
    """`admitsDerivedForLiveSurface`."""
    return season in STAT_LINE_GAPS and season in LIVE_ADMITTED_DERIVED_SEASONS
