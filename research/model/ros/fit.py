"""THE ROUND'S FIT: every number `commish_ros_v1` reads, on the preregistered seasons and grids.

Order: the opportunity line (board-free, its own seasons), then on the fit seasons' populations the
off-board rate and availability, the shrinkage (k, alpha) per position and format, the availability
shrinkage k_q per position, the return rates after an absence, and last the interval, which needs
every other number. Every outcome is read through the fit's reader, which refuses the judgment
season and the pristine one. A search's tie keeps the smaller value (the grid's earlier cell).
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Final

import numpy as np
from sqlalchemy import Connection

from research.errors import ResearchError
from research.model.domain import Position
from research.model.instants import FAR_FUTURE
from research.model.reads.observations import ObservationQuery, WeekRange
from research.model.ros.gates import Thresholds
from research.model.ros.model import (
    BANDS,
    FORMATS,
    LAST_FANTASY_WEEK,
    NO_INTERVAL,
    STREAK_CAP,
    OpportunityLine,
    PlayerToDate,
    RosPriors,
    Shrinkage,
    band_of,
    cell,
    opportunity_rate,
    play_rate,
    prior_rate,
    project,
    season_rate,
)
from research.model.ros.outcomes import OutcomeReader
from research.model.ros.reads import StaleBoard, games_played, week_inputs
from research.model.ros.statistics import population
from research.model.weekly.round.scoring import SKILL_POSITIONS

K_GRID: Final = (0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 32)
ALPHA_GRID: Final = tuple(round(0.1 * i, 1) for i in range(11))
KQ_GRID: Final = (1, 2, 3, 4, 6, 8, 12, 16, 24, 32)
INTERVAL_PERCENTILES: Final = (10.0, 50.0, 90.0)
MIN_INTERVAL_CELL: Final = 30


class RosFitError(ResearchError):
    """A fitted quantity whose cell holds no data to fit it on."""


@dataclass(frozen=True, slots=True)
class FitRow:
    season: int
    week: int
    player: PlayerToDate
    actual: dict[str, float]
    actual_games: int
    next_played: bool | None
    later_games: int
    in_population: frozenset[str]


def fit_opportunity(
    conn: Connection, seasons: Sequence[int], positions: dict[str, Position], reader: OutcomeReader
) -> dict[str, OpportunityLine]:
    """Per position and format, a game's points on its targets, carries, pass attempts and snap share."""
    rows: dict[str, list[tuple[list[float], float]]] = {}
    for season in seasons:
        reader.admit(season)
        query = ObservationQuery(season, WeekRange(1, LAST_FANTASY_WEEK), FAR_FUTURE)
        for player_id, games in games_played(conn, query, positions).items():
            position = positions[player_id]
            for game in games:
                usage = [1.0, game.targets, game.carries, game.pass_attempts, game.snap_share]
                for name in FORMATS:
                    rows.setdefault(cell(position, name), []).append((usage, game.points[name]))
    lines: dict[str, OpportunityLine] = {}
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            found = rows.get(cell(position, name), [])
            if not found:
                raise RosFitError(f"no played games to fit the {position} {name} opportunity line on")
            x = np.array([usage for usage, _ in found])
            y = np.array([points for _, points in found])
            coefficients = np.linalg.lstsq(x, y, rcond=None)[0]
            lines[cell(position, name)] = OpportunityLine(*(float(c) for c in coefficients))
    return lines


def collect(  # noqa: PLR0913, PLR0917 - the reads one fit season needs
    conn: Connection,
    season: int,
    stale: StaleBoard,
    positions: dict[str, Position],
    reader: OutcomeReader,
    t: Thresholds,
) -> list[FitRow]:
    """Every population player at every fit week of one season, with his rest-of-season outcome."""
    outcomes = reader.season(conn, season, positions)
    rows: list[FitRow] = []
    for week in t.fit_weeks:
        players = week_inputs(conn, season, week, stale, positions).players
        pops = {(p, f): population(players, p, f, t.population[p]) for p in SKILL_POSITIONS for f in FORMATS}
        for player in players:
            formats = frozenset(f for f in FORMATS if player.player_id in pops[(player.position, f)])
            if not formats:
                continue
            actual, games = outcomes.rest_of_season(player.player_id, week)
            weeks = outcomes.by_player.get(player.player_id, {})
            ahead = player.remaining_weeks
            next_played = None if not ahead else (ahead[0] in weeks and weeks[ahead[0]].played)
            later = sum(1 for w in ahead[1:] if w in weeks and weeks[w].played)
            rows.append(FitRow(season, week, player, actual, games, next_played, later, formats))
    return rows


def _ratio(numerator: float, denominator: float, what: str) -> float:
    if denominator <= 0:
        raise RosFitError(f"no data to fit {what} on")
    return numerator / denominator


def fit_offboard(rows: Sequence[FitRow]) -> tuple[dict[str, float], dict[str, float]]:
    """Off-board players' points a game (per position and format) and their play rate (per position)."""
    rates: dict[str, float] = {}
    availability: dict[str, float] = {}
    for position in SKILL_POSITIONS:
        off = [r for r in rows if r.player.position == position and r.player.stale is None]
        for name in FORMATS:
            kept = [r for r in off if name in r.in_population]
            what = f"the {position} {name} off-board rate"
            rates[cell(position, name)] = _ratio(
                sum(r.actual[name] for r in kept), sum(r.actual_games for r in kept), what
            )
        kept = [r for r in off if "ppr" in r.in_population]
        availability[position] = _ratio(
            sum(r.actual_games for r in kept),
            sum(r.player.remaining for r in kept),
            f"the {position} off-board play rate",
        )
    return rates, availability


def _argmin[T](grid: Sequence[T], loss: Callable[[T], float]) -> T:
    best, best_loss = grid[0], loss(grid[0])
    for candidate in grid[1:]:
        found = loss(candidate)
        if found < best_loss:
            best, best_loss = candidate, found
    return best


@dataclass(frozen=True, slots=True)
class RateCell:
    """One position and format's rows as arrays: the prior, games, form, opportunity and outcome."""

    prior: np.ndarray
    games: np.ndarray
    form: np.ndarray
    opportunity: np.ndarray
    target: np.ndarray
    weight: np.ndarray

    def loss(self, shrink: Shrinkage) -> float:
        """The games-weighted squared error of the shrunk rate (`model.shrunk_rate`, vectorised)."""
        blended = shrink.alpha * self.form + (1 - shrink.alpha) * self.opportunity
        rate = (shrink.k * self.prior + self.games * blended) / (shrink.k + self.games)
        return float(np.sum(self.weight * (np.maximum(rate, 0.0) - self.target) ** 2))


def rate_cell(rows: Sequence[FitRow], name: str, partial: RosPriors, line: OpportunityLine) -> RateCell:
    return RateCell(
        np.array([prior_rate(r.player, name, partial) for r in rows]),
        np.array([len(r.player.played) for r in rows], dtype=float),
        np.array([season_rate(r.player, name) or 0.0 for r in rows]),
        np.array([opportunity_rate(r.player, line) or 0.0 for r in rows]),
        np.array([r.actual[name] / r.actual_games for r in rows]),
        np.array([r.actual_games for r in rows], dtype=float),
    )


SHRINKAGE_GRID: Final = tuple(Shrinkage(float(k), alpha) for k in K_GRID for alpha in ALPHA_GRID)


def fit_shrinkage(rows: Sequence[FitRow], partial: RosPriors) -> dict[str, Shrinkage]:
    """(k, alpha) per position and format: games-weighted squared error of the rest-of-season rate."""
    found: dict[str, Shrinkage] = {}
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            key = cell(position, name)
            kept = [r for r in rows if r.player.position == position and name in r.in_population and r.actual_games]
            if not kept:
                raise RosFitError(f"no rows to fit the {position} {name} shrinkage on")
            found[key] = _argmin(SHRINKAGE_GRID, rate_cell(kept, name, partial, partial.opportunity[key]).loss)
    return found


@dataclass(frozen=True, slots=True)
class GamesCell:
    """One position's streak-0 rows: availability, games played, club games, games left, games played after."""

    rows: tuple[tuple[float, int, int, int, int], ...]

    def loss(self, k: float) -> float:
        return sum((play_rate(a, played, club, k) * left - actual) ** 2 for a, played, club, left, actual in self.rows)


def fit_availability(rows: Sequence[FitRow], partial: RosPriors) -> dict[str, float]:
    """k_q per position: squared error of expected against played rest-of-season games, streak 0."""
    found: dict[str, float] = {}
    for position in SKILL_POSITIONS:
        kept = tuple(
            (
                r.player.stale.availability if r.player.stale else partial.offboard_availability[position],
                len(r.player.played),
                len(r.player.club_weeks),
                r.player.remaining,
                r.actual_games,
            )
            for r in rows
            if r.player.position == position
            and "ppr" in r.in_population
            and r.player.streak == 0
            and r.player.remaining
        )
        if not kept:
            raise RosFitError(f"no rows to fit the {position} availability shrinkage on")
        found[position] = _argmin(tuple(float(k) for k in KQ_GRID), GamesCell(kept).loss)
    return found


def fit_returns(rows: Sequence[FitRow]) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """After an absence of 1, 2 or 3+ games: the share who play the next game, and games played over
    games scheduled after it, pooled over positions."""
    following: list[float] = []
    later: list[float] = []
    for streak in range(1, STREAK_CAP + 1):
        kept = [
            r
            for r in rows
            if "ppr" in r.in_population and min(r.player.streak, STREAK_CAP) == streak and r.next_played is not None
        ]
        following.append(_ratio(sum(1 for r in kept if r.next_played), len(kept), f"the streak-{streak} return"))
        later.append(
            _ratio(
                sum(r.later_games for r in kept), sum(r.player.remaining - 1 for r in kept), f"streak-{streak} later"
            )
        )
    return (following[0], following[1], following[2]), (later[0], later[1], later[2])


def _ratios_by_key(
    rows: Sequence[FitRow], priors: RosPriors, keys_of: Callable[[int], list[str]]
) -> dict[str, list[float]]:
    """Actual over projected for every population row with a projection, under each key its week feeds."""
    ratios: dict[str, list[float]] = {}
    for r in rows:
        projected = project(r.player, priors).projected
        for name in r.in_population:
            if projected[name] > 0:
                for suffix in keys_of(r.week):
                    key = f"{cell(r.player.position, name)}|{suffix}"
                    ratios.setdefault(key, []).append(r.actual[name] / projected[name])
    return ratios


def interval_weeks(t: Thresholds) -> tuple[int, ...]:
    """The projection weeks a per-week interval is fitted for: every served week through 17."""
    first = (t.switch_week or 1) + 1
    return tuple(range(first, LAST_FANTASY_WEEK + 1))


def window(week: int, collected: Sequence[int]) -> list[int]:
    """Weeks W-1, W, W+1, clamped to the collected weeks (round 2)."""
    low, high = min(collected), max(collected)
    centre = min(max(week, low + 1), high - 1)
    return [w for w in (centre - 1, centre, centre + 1) if w in collected]


def fit_interval(rows: Sequence[FitRow], priors: RosPriors, t: Thresholds) -> dict[str, tuple[float, float, float]]:
    """Per position and format, and per band (round 1) or projection week (round 2): the 10th, 50th
    and 90th percentiles of actual over projected."""
    if priors.interval_by == "week":
        weeks = interval_weeks(t)
        feeds = {w: [f"week{target}" for target in weeks if w in window(target, t.fit_weeks)] for w in t.fit_weeks}
        ratios = _ratios_by_key(rows, priors, lambda week: feeds.get(week, []))
        suffixes = [f"week{w}" for w in weeks]
    else:
        ratios = _ratios_by_key(rows, priors, lambda week: [band_of(week)])
        suffixes = [band for band, _, _ in BANDS]
    found: dict[str, tuple[float, float, float]] = {}
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            for suffix in suffixes:
                key = f"{cell(position, name)}|{suffix}"
                values = ratios.get(key, [])
                if len(values) < MIN_INTERVAL_CELL:
                    raise RosFitError(f"{key} holds {len(values)} rows, fewer than {MIN_INTERVAL_CELL}")
                low, mid, high = np.percentile(np.array(values), INTERVAL_PERCENTILES)
                found[key] = (float(low), float(mid), float(high))
    return found


def fit_priors(rows: Sequence[FitRow], opportunity: dict[str, OpportunityLine], t: Thresholds) -> RosPriors:
    """Every number on the search weeks' rows; the interval on every collected week's."""
    searched = [r for r in rows if r.week in t.search_weeks]
    rates, availability = fit_offboard(searched)
    partial = RosPriors(
        MappingProxyType(opportunity), MappingProxyType({}), MappingProxyType({}), (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0), MappingProxyType(rates), MappingProxyType(availability), MappingProxyType({}),
        t.interval_by,
    )  # fmt: skip
    following, later = fit_returns(searched)
    partial = replace(
        partial,
        shrinkage=MappingProxyType(fit_shrinkage(searched, partial)),
        availability_k=MappingProxyType(fit_availability(searched, partial)),
        return_next=following,
        return_later=later,
    )
    if t.interval_by == NO_INTERVAL:
        return partial
    return replace(partial, interval=MappingProxyType(fit_interval(rows, partial, t)))
