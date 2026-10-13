"""SNAP COUNTS AND TARGETS: the participation layer (`src/projections/nflverse/map.ts`).

A box score says five catches on eight targets and cannot say whether the man played twenty snaps
or sixty. This joins the snap-count file (the denominator) to the weekly stats file (the
numerators) into one row per projected player per week, each stamped when its game's numbers
became knowable.

PARITY NOTE: the TypeScript keys its usage maps on the RAW `week` text of the weekly file
(`${row.player_id}|${row.week}`) and looks them up with the NUMBER parsed from the snap-count row.
The two agree only when both spell the week the same way, and this port keeps exactly that
behaviour (raw text on one side, `js_string(number)` on the other) rather than tidying it.
"""

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from research.errors import SchemaDriftError
from research.pipeline.jscompat import js_is_finite, js_number, js_string, js_trim
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.players import (
    PlayerRef,
    PlayerUniverse,
    UnresolvedRef,
    is_projected_candidate,
)
from research.pipeline.observations import PlayerWeekObservation


class NflverseSource:
    SNAP_COUNTS = "nflverse_snap_counts"
    PLAYER_WEEK = "nflverse_player_week"


class ParticipationMetric:
    OFFENSIVE_SNAPS = "offensive_snaps"
    TEAM_OFFENSIVE_SNAPS = "team_offensive_snaps"
    ROUTES_RUN = "routes_run"
    TARGETS = "targets"
    TEAM_TARGETS = "team_targets"
    CARRIES = "carries"
    TEAM_CARRIES = "team_carries"
    PASS_ATTEMPTS = "pass_attempts"
    TEAM_PASS_ATTEMPTS = "team_pass_attempts"


# The earliest season nflverse's snap_counts release carries ROWS for (2011 and older 404, 2012 is
# a header-only file). An asset bound, not a scope bound.
SNAP_COUNT_ASSET_FLOOR = 2013

_GAME_DATE = re.compile(r"^(\d{4})(\d{2})(\d{2})")


@dataclass(frozen=True)
class PlayerWeekParticipation:
    player_id: str
    season: int
    week: int
    offensive_snaps: float
    team_offensive_snaps: float
    routes_run: float | None
    targets: float
    carries: float
    pass_attempts: float
    team_targets: float
    team_carries: float
    team_pass_attempts: float
    as_of: datetime


@dataclass(frozen=True)
class ParticipationResult:
    participation: list[PlayerWeekParticipation]
    unresolved: Sequence[UnresolvedRef]
    resolution_rate: float | None


def numeric(row: CsvRow, column: str, what: str = "nflverse row") -> float:
    """A required numeric field. Empty or unparseable throws, never reads as zero."""
    raw = row.get(column)
    value = float("nan") if raw is None or js_trim(raw) == "" else js_number(raw)
    if not js_is_finite(value):
        raise SchemaDriftError(f"{what} has no readable {column} (got {_json(raw)}).")
    return value


def optional_numeric(row: CsvRow, column: str, what: str = "nflverse row") -> float:
    """A field nflverse may leave blank rather than writing 0. Blank is 0; garbage throws."""
    raw = row.get(column)
    if raw is None or js_trim(raw) == "":
        return 0.0
    value = js_number(raw)
    if not js_is_finite(value):
        raise SchemaDriftError(f"{what} has an unreadable {column} (got {_json(raw)}).")
    return value


def _json(raw: str | None) -> str:
    return "undefined" if raw is None else json.dumps(raw)


def utc_day_plus(year: int, month: int, day: int) -> datetime:
    """`Date.UTC(year, month - 1, day)` with JavaScript's overflow arithmetic (day 32 is next month)."""
    month_index = month - 1
    base = datetime(year + month_index // 12, month_index % 12 + 1, 1, tzinfo=UTC)
    return base + timedelta(days=day - 1)


def game_day_as_of(pfr_game_id: str, lag_hours: int) -> datetime:
    """`gameDayAsOf`: the END of the game's UTC day plus the publication lag, never earlier."""
    match = _GAME_DATE.match(pfr_game_id)
    if match is None:
        raise SchemaDriftError(
            f'nflverse pfr_game_id "{pfr_game_id}" carries no readable date; an observation cannot be stamped.'
        )
    year, month, day = (int(group) for group in match.groups())
    return utc_day_plus(year, month, day + 1) + timedelta(hours=lag_hours)


def week_as_of_from_snap_counts(rows: Sequence[CsvRow], lag_hours: int) -> dict[float, datetime]:
    """`weekAsOfFromSnapCounts`: each week dated from its LAST game."""
    by_week: dict[float, datetime] = {}
    for row in rows:
        if row.get("game_type") != SEASON_TYPE:
            continue
        week = numeric(row, "week")
        as_of = game_day_as_of(row.get("pfr_game_id") or "", lag_hours)
        known = by_week.get(week)
        if known is None or as_of > known:
            by_week[week] = as_of
    return by_week


def _team_snaps_by_game(rows: Sequence[CsvRow]) -> dict[str, float]:
    totals: dict[str, float] = {}
    for row in rows:
        if row.get("game_type") != SEASON_TYPE:
            continue
        key = f"{_raw(row, 'game_id')}|{_raw(row, 'team')}"
        snaps = numeric(row, "offense_snaps")
        totals[key] = max(totals.get(key, 0.0), snaps)
    return totals


def _raw(row: CsvRow, column: str) -> str:
    """A template literal of a possibly-missing CSV field: `${row.x}` prints `undefined`."""
    value = row.get(column)
    return "undefined" if value is None else value


@dataclass(frozen=True)
class _Usage:
    targets: float
    carries: float
    pass_attempts: float


_NO_USAGE = _Usage(0.0, 0.0, 0.0)


def _usage_by_player_and_team(rows: Sequence[CsvRow]) -> tuple[dict[str, _Usage], dict[str, _Usage]]:
    by_player: dict[str, _Usage] = {}
    by_team: dict[str, _Usage] = {}
    for row in rows:
        if row.get("season_type") != SEASON_TYPE:
            continue
        usage = _Usage(
            targets=optional_numeric(row, "targets"),
            carries=optional_numeric(row, "carries"),
            pass_attempts=optional_numeric(row, "attempts"),
        )
        by_player[f"{row.get('player_id') or ''}|{row.get('week') or ''}"] = usage
        team_key = f"{row.get('team') or ''}|{row.get('week') or ''}"
        running = by_team.get(team_key, _NO_USAGE)
        by_team[team_key] = _Usage(
            targets=running.targets + usage.targets,
            carries=running.carries + usage.carries,
            pass_attempts=running.pass_attempts + usage.pass_attempts,
        )
    return by_player, by_team


def _nullish(row: CsvRow, column: str) -> str:
    """`row.x ?? ""`: a missing field reads as empty, an empty one stays empty."""
    value = row.get(column)
    return "" if value is None else value


def map_participation(
    snap_counts: Sequence[CsvRow],
    player_week: Sequence[CsvRow],
    universe: PlayerUniverse,
    publication_lag_hours: int = PUBLICATION_LAG_HOURS,
) -> ParticipationResult:
    """`mapParticipation`: the denominator over every position, the output narrowed by the universe."""
    team_snaps = _team_snaps_by_game(snap_counts)
    player_usage, team_usage = _usage_by_player_and_team(player_week)

    scored: list[CsvRow] = []
    refs: list[PlayerRef] = []
    for row in snap_counts:
        if row.get("game_type") != SEASON_TYPE:
            continue
        ref = PlayerRef(kind="pfr", id=_nullish(row, "pfr_player_id"), name=_nullish(row, "player"))
        if not is_projected_candidate(universe, ref, row.get("position")):
            continue
        scored.append(row)
        refs.append(ref)
    resolution = universe.resolve_all(refs)

    participation: list[PlayerWeekParticipation] = []
    for row, ref in zip(scored, refs, strict=True):
        player_id = resolution.resolved.get(ref.id)
        if player_id is None:
            continue
        week = numeric(row, "week")
        own = player_usage.get(f"{player_id}|{js_string(week)}", _NO_USAGE)
        team = team_usage.get(f"{_raw(row, 'team')}|{js_string(week)}", _NO_USAGE)
        participation.append(
            PlayerWeekParticipation(
                player_id=player_id,
                season=int(numeric(row, "season")),
                week=int(week),
                offensive_snaps=numeric(row, "offense_snaps"),
                team_offensive_snaps=team_snaps.get(f"{_raw(row, 'game_id')}|{_raw(row, 'team')}", 0.0),
                routes_run=None,
                targets=own.targets,
                carries=own.carries,
                pass_attempts=own.pass_attempts,
                team_targets=team.targets,
                team_carries=team.carries,
                team_pass_attempts=team.pass_attempts,
                as_of=game_day_as_of(_nullish(row, "pfr_game_id"), publication_lag_hours),
            )
        )
    return ParticipationResult(
        participation=participation, unresolved=resolution.unresolved, resolution_rate=resolution.resolution_rate
    )


def participation_observations(rows: Sequence[PlayerWeekParticipation]) -> list[PlayerWeekObservation]:
    """`participationObservations`: a metric nobody published emits no row, never a zero."""
    observations: list[PlayerWeekObservation] = []
    for row in rows:

        def stamp(source: str, metric: str, value: float, row: PlayerWeekParticipation = row) -> PlayerWeekObservation:
            return PlayerWeekObservation(
                season=row.season,
                week=row.week,
                player_id=row.player_id,
                source=source,
                metric=metric,
                value=value,
                as_of=row.as_of,
            )

        snaps, week_file = NflverseSource.SNAP_COUNTS, NflverseSource.PLAYER_WEEK
        observations.extend(
            [
                stamp(snaps, ParticipationMetric.OFFENSIVE_SNAPS, row.offensive_snaps),
                stamp(snaps, ParticipationMetric.TEAM_OFFENSIVE_SNAPS, row.team_offensive_snaps),
                stamp(week_file, ParticipationMetric.TARGETS, row.targets),
                stamp(week_file, ParticipationMetric.TEAM_TARGETS, row.team_targets),
                stamp(week_file, ParticipationMetric.CARRIES, row.carries),
                stamp(week_file, ParticipationMetric.TEAM_CARRIES, row.team_carries),
                stamp(week_file, ParticipationMetric.PASS_ATTEMPTS, row.pass_attempts),
                stamp(week_file, ParticipationMetric.TEAM_PASS_ATTEMPTS, row.team_pass_attempts),
            ]
        )
        if row.routes_run is not None:
            observations.append(stamp(week_file, ParticipationMetric.ROUTES_RUN, row.routes_run))
    return observations
