"""WHAT THE MODEL SEES AT A WEEK'S MOMENT, READ FROM THE RESEARCH STORE.

The stale board is the house's preseason builder at its replay moment (`build_season`), in each of
the three scoring formats. A week's inputs are read at one millisecond before its first kickoff
(`week_moment`): the published lines and usage of the season's earlier weeks, the club edges, and
the schedule published in May. Nothing here reads an outcome; outcomes go through `outcomes.py`.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.model.arithmetic import Arithmetic
from research.model.domain import Position, compute_fantasy_points
from research.model.preseason.board import BoardEntry
from research.model.preseason.persist import build_season
from research.model.priors import ModelArtifacts
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_as_of, usage_as_of
from research.model.reads.teams import player_teams_as_of, team_observations_as_of
from research.model.ros.model import FORMATS, LAST_FANTASY_WEEK, SEASON_GAMES, GamePlayed, PlayerToDate, StaleEntry
from research.model.weekly.inputs import week_moment
from research.model.weekly.round.scoring import FORMATS as FORMAT_RULES
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource

SERVED_SOURCE: Final = "commish_board_v9_ppr_12"
RAW_SOURCE: Final = "commish_board_v1_ppr_12"


@dataclass(frozen=True, slots=True)
class StalePlayer:
    position: Position
    team: str
    entry: StaleEntry


@dataclass(frozen=True, slots=True)
class StaleBoard:
    season: int
    moment: datetime
    players: Mapping[str, StalePlayer]


def stale_entry(
    projected: Mapping[str, float], games: float, per_game: Mapping[str, float] | None = None
) -> StaleEntry:
    """Season points, the availability from the served games, and points a game: the served points
    over its games (round 1) unless a line's own points a game are given (round 2)."""
    if per_game is None:
        per_game = {name: projected[name] / games if games > 0 else 0.0 for name in FORMATS}
    return StaleEntry(
        MappingProxyType(dict(projected)), MappingProxyType(dict(per_game)), min(1.0, games / SEASON_GAMES)
    )


def raw_per_game(raw: BoardEntry) -> dict[str, float] | None:
    """The raw board's season line scored in each format over its own expected games (round 2), so a
    capped player's availability lives only in expected games; None when it expects no games."""
    if raw.expected_games <= 0:
        return None
    return {
        name: compute_fantasy_points(raw.season_line, raw.position, FORMAT_RULES[name]) / raw.expected_games
        for name in FORMATS
    }


def format_ratios(raw: BoardEntry) -> dict[str, float]:
    """The raw model's own season line scored in each format, over its PPR points (Amendment 1)."""
    ppr = compute_fantasy_points(raw.season_line, raw.position, FORMAT_RULES["ppr"])
    if ppr <= 0:
        return dict.fromkeys(FORMATS, 1.0)
    return {name: compute_fantasy_points(raw.season_line, raw.position, FORMAT_RULES[name]) / ppr for name in FORMATS}


def build_stale_board(
    conn: Connection, season: int, artifacts: ModelArtifacts, arithmetic: Arithmetic, prior_source: str = "served"
) -> StaleBoard:
    """The served PPR board as the house's builder makes it for `season`, carried to half PPR and
    standard by the raw model's own ratio of format points to PPR points (Amendment 1: a past
    season's half and standard boards are flat market tails, the store holding 5-20 of their ADP rows)."""
    built = build_season(conn, season, datetime.now(UTC), artifacts, arithmetic)
    raw = {e.player_id: e for e in built.boards[RAW_SOURCE].board}
    players: dict[str, StalePlayer] = {}
    for served in built.boards[SERVED_SOURCE].board:
        if served.position not in SKILL_POSITIONS:
            continue
        found = raw.get(served.player_id)
        ratios = format_ratios(found) if found is not None else dict.fromkeys(FORMATS, 1.0)
        projected = {name: served.projected_points * ratios[name] for name in FORMATS}
        if prior_source == "raw":
            per_game = raw_per_game(found) if found is not None else None
            entry = stale_entry(projected, served.expected_games, per_game)
            entry = entry if per_game is not None else replace(entry, per_game=None)
        else:
            entry = stale_entry(projected, served.expected_games)
        players[served.player_id] = StalePlayer(served.position, served.team, entry)
    return StaleBoard(season, built.inputs.moment, MappingProxyType(players))


def club_schedule(conn: Connection, season: int, as_of: datetime) -> dict[str, frozenset[int]]:
    """Each club's scheduled weeks through week 17, as the May schedule publishes them."""
    rows = team_observations_as_of(conn, season, WeekRange(1, LAST_FANTASY_WEEK), as_of, ScheduleSource.SCHEDULE)
    weeks: dict[str, set[int]] = {}
    for row in rows:
        if row.metric == ScheduleMetric.HOME_FIELD:
            weeks.setdefault(row.team, set()).add(row.week)
    return {club: frozenset(found) for club, found in weeks.items()}


@dataclass(frozen=True, slots=True)
class WeekInputs:
    season: int
    week: int
    moment: datetime
    players: tuple[PlayerToDate, ...]


def games_played(
    conn: Connection, query: ObservationQuery, positions: Mapping[str, Position]
) -> dict[str, list[GamePlayed]]:
    lines = {(r.line.week, r.line.player_id): r.line for r in stat_lines_as_of(conn, query)}
    usage = {(u.week, u.player_id): u for u in usage_as_of(conn, query)}
    played: dict[str, list[GamePlayed]] = {}
    for key in sorted({*lines, *(k for k, u in usage.items() if (u.snap_share or 0.0) > 0)}):
        week, player_id = key
        position = positions.get(player_id)
        if position is None or position not in SKILL_POSITIONS:
            continue
        line, use = lines.get(key), usage.get(key)
        points = {
            name: 0.0 if line is None else compute_fantasy_points(line, position, FORMAT_RULES[name])
            for name in FORMATS
        }
        played.setdefault(player_id, []).append(
            GamePlayed(
                week,
                MappingProxyType(points),
                (use.targets if use else None) or 0.0,
                (use.carries if use else None) or 0.0,
                (use.pass_attempts if use else None) or 0.0,
                (use.snap_share if use else None) or 0.0,
            )
        )
    return played


def _latest_clubs(conn: Connection, season: int, week: int, moment: datetime) -> dict[str, str]:
    """Each player's club at his latest week of this season (the season-aware rule)."""
    latest: dict[str, tuple[int, str]] = {}
    for edge in player_teams_as_of(conn, season, WeekRange(1, week - 1), moment):
        held = latest.get(edge.player_id)
        if held is None or edge.week >= held[0]:
            latest[edge.player_id] = (edge.week, edge.team)
    return {player_id: team for player_id, (_, team) in latest.items()}


def week_inputs(
    conn: Connection, season: int, week: int, stale: StaleBoard, positions: Mapping[str, Position]
) -> WeekInputs:
    """The universe at (season, week): every stale-board player and every player who has played."""
    moment = week_moment(conn, season, week)
    played = games_played(conn, ObservationQuery(season, WeekRange(1, week - 1), moment), positions) if week > 1 else {}
    clubs = _latest_clubs(conn, season, week, moment) if week > 1 else {}
    schedule = club_schedule(conn, season, moment)
    players: list[PlayerToDate] = []
    for player_id in sorted({*stale.players, *played}):
        board = stale.players.get(player_id)
        position = board.position if board is not None else positions[player_id]
        club = clubs.get(player_id) or (board.team if board is not None else None)
        weeks = schedule.get(club or "", frozenset())
        players.append(
            PlayerToDate(
                player_id,
                position,
                tuple(sorted(w for w in weeks if w < week)),
                tuple(played.get(player_id, ())),
                tuple(sorted(w for w in weeks if week <= w <= LAST_FANTASY_WEEK)),
                None if board is None else board.entry,
            )
        )
    return WeekInputs(season, week, moment, tuple(players))


def to_date_points(players: Sequence[PlayerToDate], format_name: str) -> dict[str, float]:
    return {p.player_id: sum(g.points[format_name] for g in p.played) for p in players}
