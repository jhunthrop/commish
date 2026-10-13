"""THE MARKET: average draft position read through a fitted points curve, per scoring format.

Ported from `research-ts/src/projections/market/{curve,format-anchor}.ts` (applying half) and
`preseason/board-formats.ts`.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from types import MappingProxyType
from typing import Final, Literal

from sqlalchemy import Connection

from research.model.domain import HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING, Position, ScoringRules
from research.model.jsmath import js_max, js_round
from research.model.reads.preseason import preseason_rankings_as_of, preseason_rosters_as_of
from research.pipeline.nflverse.players import projected_position

CURVE_POSITIONS: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE")
BoardFormat = Literal["ppr", "half", "std"]
BOARD_FORMATS: Final[tuple[BoardFormat, ...]] = ("ppr", "half", "std")
DEFAULT_BOARD_FORMAT: Final[BoardFormat] = "ppr"
BOARD_SOURCE_VERSION: Final = "v9"
BOARD_TEAM_COUNT: Final = 12
ADP_SOURCES: Final[Mapping[BoardFormat, str]] = MappingProxyType(
    {"ppr": "ffc_adp_ppr_12", "half": "ffc_adp_half_12", "std": "ffc_adp_std_12"}
)
ECR_SOURCE: Final = "fantasypros_ecr_ppr"
FORMAT_RULES: Final[Mapping[BoardFormat, ScoringRules]] = MappingProxyType(
    {"ppr": PPR_SCORING, "half": HALF_PPR_SCORING, "std": STANDARD_SCORING}
)
RAW_BOARD_SOURCE: Final = "commish_board_v1_ppr_12"
TAIL_EXCHANGE_FROM: Final = 100
TAIL_EXCHANGE_TO: Final = 150


def board_source_for(board_format: BoardFormat) -> str:
    """`boardSourceFor`."""
    return f"commish_board_{BOARD_SOURCE_VERSION}_{board_format}_{BOARD_TEAM_COUNT}"


@dataclass(frozen=True, slots=True)
class MarketCurveKnot:
    adp_rank: float
    points: float


MarketCurvePriors = Mapping[Position, tuple[MarketCurveKnot, ...]]


def parse_market_curve(raw: Mapping[str, Sequence[Mapping[str, float]]]) -> MarketCurvePriors:
    return MappingProxyType(
        {
            position: tuple(MarketCurveKnot(float(k["adpRank"]), float(k["points"])) for k in knots)
            for position, knots in raw.items()
        }
    )


def _raw_market_curve(position: Position, adp_rank: float, priors: MarketCurvePriors) -> float:
    if position not in CURVE_POSITIONS:
        return 0.0
    knots = priors[position]
    if not knots:
        return 0.0
    if adp_rank <= knots[0].adp_rank:
        return knots[0].points
    if adp_rank >= knots[-1].adp_rank:
        return knots[-1].points
    above_index = next(index for index, knot in enumerate(knots) if adp_rank <= knot.adp_rank)
    below = knots[above_index]
    above = knots[above_index - 1]
    weight = (adp_rank - above.adp_rank) / (below.adp_rank - above.adp_rank)
    return above.points + (below.points - above.points) * weight


def market_curve(position: Position, adp_rank: float, priors: MarketCurvePriors) -> float:
    """`marketCurve`: the curve's points at an ADP, never below zero."""
    return js_max(0.0, _raw_market_curve(position, adp_rank, priors))


@dataclass(frozen=True, slots=True)
class MarketPriorEntry:
    player_id: str
    position: Position
    adp_rank: float
    market_points: float


def market_board(
    conn: Connection, season: int, as_of: datetime, priors: MarketCurvePriors, adp_source: str
) -> tuple[list[MarketPriorEntry], int]:
    """`marketBoard`: (entries in the ranking read's order, rows dropped for an uncurved position)."""
    board = preseason_rankings_as_of(conn, season, adp_source, as_of)
    if not board:
        return [], 0
    position_of = {row.player_id: row.position for row in preseason_rosters_as_of(conn, season, as_of)}
    entries: list[MarketPriorEntry] = []
    dropped = 0
    for row in board:
        raw = position_of.get(row.player_id)
        position = None if raw is None else projected_position(raw)
        if position is None or position not in CURVE_POSITIONS:
            dropped += 1
            continue
        entries.append(MarketPriorEntry(row.player_id, position, row.rank, market_curve(position, row.rank, priors)))
    return entries, dropped


def rounded_rank(rank: float) -> float:
    """`roundedRank`: the nearest whole slot, at least 1."""
    return js_max(1.0, js_round(rank))


def _band_mean(priors: MarketCurvePriors, position: Position) -> float:
    total = 0.0
    for rank in range(TAIL_EXCHANGE_FROM, TAIL_EXCHANGE_TO + 1):
        total += market_curve(position, rank, priors)
    return total / (TAIL_EXCHANGE_TO - TAIL_EXCHANGE_FROM + 1)


def market_tail_at_exchange_rate(
    base: Mapping[str, float], ppr_curve: MarketCurvePriors, format_curve: MarketCurvePriors
) -> dict[str, float]:
    """`marketTailAtExchangeRate`: the PPR tail caps moved by each position's curve ratio."""
    out: dict[str, float] = {}
    for position in CURVE_POSITIONS:
        ppr_mean = _band_mean(ppr_curve, position)
        format_mean = _band_mean(format_curve, position)
        if not (ppr_mean > 0) or not (format_mean > 0):
            raise ValueError(
                f"marketTailAtExchangeRate: a curve carries nothing at {position} across slots {TAIL_EXCHANGE_FROM}-{TAIL_EXCHANGE_TO}"
            )
        out[position] = (base[position] * format_mean) / ppr_mean
    return out
