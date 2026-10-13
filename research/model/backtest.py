"""VALIDATION AND THE HELD-OUT BACKTEST: rank correlation, error, by band, against what happened.

Ported from `research-ts/src/projections/{metrics,preseason/scorecard}.ts` and the nightly run's
`reads/held-out.ts`: for each held-out season, the served board's newest stored generation scored
against every player's regular-season points. The board is rewritten only by the fit, so this
number moves only when the fit moved it.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from sqlalchemy import Connection, text

from research.model.domain import PPR_SCORING, Position, ScoringRules, compute_fantasy_points
from research.model.instants import FAR_FUTURE
from research.model.jsmath import js_sorted, locale_compare
from research.model.reads.observations import ObservationQuery, WeekRange, stat_lines_as_of
from research.model.reads.preseason import all_positions

LAST_REGULAR_WEEK: Final = 18
RANK_BANDS: Final = (("elite", 1, 50), ("starter", 51, 150), ("deep", 151, 400), ("fringe", 401, 2**53 - 1))
SERVED_SOURCE: Final = "commish_board_v9_ppr_12"


@dataclass(frozen=True, slots=True)
class Observation:
    predicted: float
    actual: float


def _average_ranks(values: Sequence[float]) -> list[float]:
    order = js_sorted(list(enumerate(values)), lambda a, b: a[1] - b[1])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        end = position
        while end + 1 < len(order) and order[end + 1][1] == order[position][1]:
            end += 1
        shared = (position + end) / 2 + 1
        for i in range(position, end + 1):
            ranks[order[i][0]] = shared
        position = end + 1
    return ranks


def _pearson(xs: Sequence[float], ys: Sequence[float]) -> float | None:
    n = len(xs)
    mean_x = sum_left(xs) / n
    mean_y = sum_left(ys) / n
    covariance = variance_x = variance_y = 0.0
    for x, y in zip(xs, ys, strict=True):
        dx = x - mean_x
        dy = y - mean_y
        covariance += dx * dy
        variance_x += dx * dx
        variance_y += dy * dy
    if variance_x == 0 or variance_y == 0:
        return None
    return covariance / math.sqrt(variance_x * variance_y)


def sum_left(values: Sequence[float]) -> float:
    total = 0.0
    for value in values:
        total += value
    return total


def _assert_finite(observations: Sequence[Observation]) -> None:
    for observation in observations:
        if not (math.isfinite(observation.predicted) and math.isfinite(observation.actual)):
            raise ValueError(
                "A projection metric received a non-finite value; check the projection source for NaN or Infinity."
            )


def spearman(observations: Sequence[Observation]) -> float | None:
    """`spearman`: Pearson on average ranks."""
    _assert_finite(observations)
    if len(observations) < 2:  # noqa: PLR2004 - a correlation needs two points
        return None
    return _pearson(
        _average_ranks([o.predicted for o in observations]), _average_ranks([o.actual for o in observations])
    )


@dataclass(frozen=True, slots=True)
class ScoreCard:
    rank_correlation: float | None
    mean_absolute_error: float | None
    root_mean_squared_error: float | None
    sample_size: int


def score_card(observations: Sequence[Observation]) -> ScoreCard:
    """`scoreCard`."""
    _assert_finite(observations)
    if not observations:
        return ScoreCard(None, None, None, 0)
    absolute = sum_left([abs(o.predicted - o.actual) for o in observations])
    squared = sum_left([(o.predicted - o.actual) * (o.predicted - o.actual) for o in observations])
    return ScoreCard(
        spearman(observations), absolute / len(observations), math.sqrt(squared / len(observations)), len(observations)
    )


def actual_season_points(
    conn: Connection, season: int, positions: Mapping[str, Position], rules: ScoringRules = PPR_SCORING
) -> dict[str, float]:
    """`actualSeasonPoints`: every player's regular-season points, final corrections included."""
    totals: dict[str, float] = {}
    for row in stat_lines_as_of(conn, ObservationQuery(season, WeekRange(1, LAST_REGULAR_WEEK), FAR_FUTURE)):
        position = positions.get(row.line.player_id)
        if position is None:
            continue
        totals[row.line.player_id] = totals.get(row.line.player_id, 0.0) + compute_fantasy_points(
            row.line, position, rules
        )
    return totals


def score_ordering(
    predicted: Mapping[str, float], actual: Mapping[str, float], eligible: set[str], band_by: Mapping[str, float] | None
) -> tuple[ScoreCard, dict[str, ScoreCard]]:
    """`scoreOrdering`: the whole population, and by rank band under a common ordering."""
    rows = [
        (player_id, value, actual[player_id])
        for player_id, value in predicted.items()
        if player_id in eligible and player_id in actual
    ]

    def compare(a: tuple[str, float, float], b: tuple[str, float, float]) -> float:
        if band_by is None:
            return (b[1] - a[1]) or locale_compare(a[0], b[0])
        return (band_by.get(a[0], math.inf) - band_by.get(b[0], math.inf)) or locale_compare(a[0], b[0])

    band_of = {row[0]: index + 1 for index, row in enumerate(js_sorted(rows, compare))}
    overall = score_card([Observation(value, outcome) for _, value, outcome in rows])
    by_band = {
        name: score_card(
            [Observation(value, outcome) for player_id, value, outcome in rows if first <= band_of[player_id] <= last]
        )
        for name, first, last in RANK_BANDS
    }
    return overall, by_band


def stored_served_board(conn: Connection, season: int) -> dict[str, float]:
    """The served board's newest stored generation for one season: player id to projected points."""
    latest = conn.execute(
        text("select max(as_of) from research.preseason_projections where season = :s and source = :source"),
        {"s": season, "source": SERVED_SOURCE},
    ).scalar()
    if latest is None:
        return {}
    rows = conn.execute(
        text(
            "select player_id, projected_points from research.preseason_projections where season = :s and source = :source and as_of = :a"
        ),
        {"s": season, "source": SERVED_SOURCE, "a": latest},
    )
    return {row.player_id: row.projected_points for row in rows}


@dataclass(frozen=True, slots=True)
class HeldOutScore:
    season: int
    rank_correlation: float | None
    sample_size: int


def held_out_scores(conn: Connection, seasons: Sequence[int]) -> list[HeldOutScore]:
    """`heldOutScores`: the stored served board against outcomes, per held-out season."""
    positions = all_positions(conn)
    scores: list[HeldOutScore] = []
    for season in seasons:
        board = stored_served_board(conn, season)
        overall, _ = score_ordering(board, actual_season_points(conn, season, positions), set(board), None)
        scores.append(HeldOutScore(season, overall.rank_correlation, overall.sample_size))
    return scores
