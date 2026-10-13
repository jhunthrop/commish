"""Which offence each player was in, and who his five linemen were (`src/projections/nflverse/team-map.ts`).

Both come free with the snap-count download: the player-to-team edge dates itself from the
player's own game, and line continuity is the part of the offensive-line composite that needs no
play-by-play. Below the snap-count asset floor the edge comes from the weekly stats' own `team`
column instead, stamped from the week's last game.
"""

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime

from research.pipeline.jscompat import js_locale_compare
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS, SEASON_TYPE
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.participation import game_day_as_of, numeric
from research.pipeline.nflverse.players import PlayerRef, PlayerUniverse, is_projected_candidate
from research.pipeline.observations import PlayerWeekTeam, TeamWeekObservation

CONTINUITY_SOURCE = "nflverse_line_continuity"


class ContinuityMetric:
    SAME_STARTERS = "line_same_starters_as_previous_week"
    STARTERS_USED = "line_starters_used_to_date"


# A set, not a prefix: "T" is a tackle and "TE" is not.
_LINE_POSITIONS = frozenset({"T", "G", "C", "OL", "OT", "OG", "LT", "RT", "LG", "RG"})
_LINE_STARTERS = 5
_SNAP_ROW = "nflverse snap-count row"


def _candidates(
    rows: Sequence[CsvRow], universe: PlayerUniverse, type_column: str, ref_of: "RefBuilder"
) -> tuple[list[CsvRow], list[PlayerRef]]:
    scored: list[CsvRow] = []
    refs: list[PlayerRef] = []
    for row in rows:
        if row.get(type_column) != SEASON_TYPE:
            continue
        ref = ref_of(row)
        if not is_projected_candidate(universe, ref, row.get("position")):
            continue
        scored.append(row)
        refs.append(ref)
    return scored, refs


class RefBuilder:
    def __init__(self, kind: str, id_column: str, name_column: str) -> None:
        self._kind = kind
        self._id_column = id_column
        self._name_column = name_column

    def __call__(self, row: CsvRow) -> PlayerRef:
        player_id = row.get(self._id_column)
        name = row.get(self._name_column)
        return PlayerRef(
            kind="pfr" if self._kind == "pfr" else "gsis",
            id="" if player_id is None else player_id,
            name="" if name is None else name,
        )


def map_player_teams(
    snap_counts: Sequence[CsvRow], universe: PlayerUniverse, lag_hours: int = PUBLICATION_LAG_HOURS
) -> list[PlayerWeekTeam]:
    """`mapPlayerTeams`: one edge per projected player-game, stamped from his own game."""
    scored, refs = _candidates(snap_counts, universe, "game_type", RefBuilder("pfr", "pfr_player_id", "player"))
    resolved = universe.resolve_all(refs).resolved
    edges: list[PlayerWeekTeam] = []
    for row, ref in zip(scored, refs, strict=True):
        player_id = resolved.get(ref.id)
        if player_id is None:
            continue
        edges.append(
            PlayerWeekTeam(
                season=int(numeric(row, "season", _SNAP_ROW)),
                week=int(numeric(row, "week", _SNAP_ROW)),
                player_id=player_id,
                team=row.get("team") or "",
                as_of=game_day_as_of(row.get("pfr_game_id") or "", lag_hours),
            )
        )
    return edges


def map_player_teams_from_weekly_stats(
    player_week: Sequence[CsvRow], season: int, week_as_of: Mapping[float, datetime], universe: PlayerUniverse
) -> list[PlayerWeekTeam]:
    """`mapPlayerTeamsFromWeeklyStats`: the same edge for seasons with no snap counts."""
    scored, refs = _candidates(
        player_week, universe, "season_type", RefBuilder("gsis", "player_id", "player_display_name")
    )
    resolved = universe.resolve_all(refs).resolved
    edges: list[PlayerWeekTeam] = []
    for row, ref in zip(scored, refs, strict=True):
        player_id = resolved.get(ref.id)
        if player_id is None:
            continue
        team = row.get("team") or ""
        if team == "":
            continue
        week = numeric(row, "week", _SNAP_ROW)
        as_of = week_as_of.get(week)
        if as_of is None:
            continue
        edges.append(PlayerWeekTeam(season=season, week=int(week), player_id=player_id, team=team, as_of=as_of))
    return edges


@dataclass
class _TeamWeek:
    team: str
    week: float
    as_of: datetime
    snaps: list[tuple[str, float]] = field(default_factory=list)


@dataclass(frozen=True)
class _WeeklyLine:
    week: float
    starters: tuple[str, ...]
    as_of: datetime


def _by_snaps_then_id(a: tuple[str, float], b: tuple[str, float]) -> int:
    difference = b[1] - a[1]
    if difference != 0:
        return -1 if difference < 0 else 1
    return js_locale_compare(a[0], b[0])


def _weekly_lines(snap_counts: Sequence[CsvRow], lag_hours: int) -> dict[str, list[_WeeklyLine]]:
    by_team_week: dict[str, _TeamWeek] = {}
    for row in snap_counts:
        if row.get("game_type") != SEASON_TYPE:
            continue
        if (row.get("position") or "") not in _LINE_POSITIONS:
            continue
        week = numeric(row, "week", _SNAP_ROW)
        team = row.get("team") or ""
        key = f"{team}|{week}"
        entry = by_team_week.get(key)
        if entry is None:
            entry = _TeamWeek(team=team, week=week, as_of=game_day_as_of(row.get("pfr_game_id") or "", lag_hours))
            by_team_week[key] = entry
        pfr_id = row.get("pfr_player_id")
        lineman = pfr_id if pfr_id is not None else (row.get("player") or "")
        entry.snaps.append((lineman, numeric(row, "offense_snaps", _SNAP_ROW)))

    by_team: dict[str, list[_WeeklyLine]] = {}
    for entry in by_team_week.values():
        ordered = sorted(entry.snaps, key=functools.cmp_to_key(_by_snaps_then_id))
        starters = tuple(lineman for lineman, _ in ordered[:_LINE_STARTERS])
        by_team.setdefault(entry.team, []).append(_WeeklyLine(week=entry.week, starters=starters, as_of=entry.as_of))
    for lines in by_team.values():
        lines.sort(key=lambda line: line.week)
    return by_team


def line_continuity_observations(
    snap_counts: Sequence[CsvRow], season: int, lag_hours: int = PUBLICATION_LAG_HOURS
) -> list[TeamWeekObservation]:
    """`lineContinuityObservations`: week 1 emits no same-starters row, never a zero."""
    rows: list[TeamWeekObservation] = []
    for team, weeks in _weekly_lines(snap_counts, lag_hours).items():
        seen: set[str] = set()
        previous: tuple[str, ...] | None = None
        for line in weeks:
            seen.update(line.starters)

            def observation(
                metric: str, value: float, line: _WeeklyLine = line, team: str = team
            ) -> TeamWeekObservation:
                return TeamWeekObservation(
                    season=season,
                    week=int(line.week),
                    team=team,
                    source=CONTINUITY_SOURCE,
                    metric=metric,
                    value=value,
                    as_of=line.as_of,
                )

            if previous is not None:
                carried = sum(1 for starter in line.starters if starter in previous)
                rows.append(observation(ContinuityMetric.SAME_STARTERS, float(carried)))
            rows.append(observation(ContinuityMetric.STARTERS_USED, float(len(seen))))
            previous = line.starters
    return rows
