"""ROOKIES FROM DRAFT CAPITAL: the shares, the game rate and the points curve a pick buys.

Ported from `research-ts/src/projections/preseason/{rookies,rookie-curve,draft-buckets}.ts`
(the applying half; the fits are in `research.model.fits.rookies`).
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final, Literal

from research.model.domain import Position
from research.model.jsmath import js_max, js_min
from research.model.weekly.opportunity import PredictedOpportunity, clamp_share

DraftBucket = Literal["round1", "round2", "round3", "rounds4to5", "rounds6to7", "undrafted"]
DRAFT_BUCKETS: Final[tuple[DraftBucket, ...]] = ("round1", "round2", "round3", "rounds4to5", "rounds6to7", "undrafted")
UNDRAFTED_PICK: Final = 300
BUCKET_ANCHOR: Final[Mapping[DraftBucket, float]] = MappingProxyType(
    {
        "round1": 16.5,
        "round2": 48.5,
        "round3": 84.5,
        "rounds4to5": 142.5,
        "rounds6to7": 220,
        "undrafted": UNDRAFTED_PICK,
    }
)
_BUCKET_LAST_PICKS: Final[tuple[tuple[int, DraftBucket], ...]] = (
    (32, "round1"),
    (64, "round2"),
    (105, "round3"),
    (180, "rounds4to5"),
)
CURVE_POSITIONS: Final[tuple[Position, ...]] = ("QB", "RB", "WR", "TE")


def draft_bucket_for(overall_pick: float | None) -> DraftBucket:
    """`draftBucketFor`."""
    if overall_pick is None or overall_pick <= 0:
        return "undrafted"
    for last_pick, bucket in _BUCKET_LAST_PICKS:
        if overall_pick <= last_pick:
            return bucket
    return "rounds6to7"


@dataclass(frozen=True, slots=True)
class RookieCurveKnot:
    pick: float
    points: float


RookieCurvePriors = Mapping[Position, Sequence[RookieCurveKnot]]


def _raw_rookie_curve(position: Position, overall_pick: float, priors: RookieCurvePriors) -> float:
    if position not in CURVE_POSITIONS:
        return 0.0
    knots = priors[position]
    if not knots:
        return 0.0
    first = knots[0]
    last = knots[-1]
    if overall_pick <= first.pick:
        return first.points
    if overall_pick >= last.pick:
        return last.points
    above_index = next(index for index, knot in enumerate(knots) if overall_pick <= knot.pick)
    below = knots[above_index]
    above = knots[above_index - 1]
    weight = (overall_pick - above.pick) / (below.pick - above.pick)
    return above.points + (below.points - above.points) * weight


def rookie_curve(position: Position, overall_pick: float, priors: RookieCurvePriors) -> float:
    """`rookieCurve`: the fitted points of a pick, interpolated between knots, never below zero."""
    return js_max(0.0, _raw_rookie_curve(position, overall_pick, priors))


@dataclass(frozen=True, slots=True)
class RookieShares:
    snap_share: float
    target_share: float
    carry_share: float
    pass_attempt_share: float


@dataclass(frozen=True, slots=True)
class RookiePriors:
    by_bucket: Mapping[Position, Mapping[DraftBucket, RookieShares]]
    league_team_volume: tuple[float, float, float]
    typical_incumbent_claim: Mapping[Position, float]
    game_rate: Mapping[Position, Mapping[DraftBucket, float]]
    landing_bound: float


@dataclass(frozen=True, slots=True)
class RookieInput:
    player_id: str
    position: Position
    team: str
    overall_pick: int | None
    incumbent_claim: float


@dataclass(frozen=True, slots=True)
class RookieFeatures:
    landing_spot: bool
    pick_curve: bool


def _capital_curve_weight(
    position: Position, above_pick: float, overall_pick: float, below_pick: float, curve: RookieCurvePriors
) -> float:
    linear = (overall_pick - above_pick) / (below_pick - above_pick)
    above_value = rookie_curve(position, above_pick, curve)
    below_value = rookie_curve(position, below_pick, curve)
    span = above_value - below_value
    if not (span > 0):
        return linear
    pick_value = rookie_curve(position, overall_pick, curve)
    return js_min(1.0, js_max(0.0, (above_value - pick_value) / span))


def _along_the_capital_curve[T](  # noqa: PLR0913, PLR0917 - the oracle's own parameters, in its order, for a line-by-line read
    cells: Mapping[DraftBucket, T],
    position: Position,
    overall_pick: int | None,
    pick_curve: bool,
    blend: Callable[[T, T, float], T],
    curve: RookieCurvePriors,
) -> T:
    if not pick_curve:
        return cells[draft_bucket_for(overall_pick)]
    if overall_pick is None or overall_pick <= 0:
        return cells["undrafted"]
    anchors = [(BUCKET_ANCHOR[bucket], cells[bucket]) for bucket in DRAFT_BUCKETS]
    if overall_pick <= anchors[0][0]:
        return anchors[0][1]
    if overall_pick >= anchors[-1][0]:
        return anchors[-1][1]
    index = next(i for i, (pick, _) in enumerate(anchors) if overall_pick <= pick)
    above_pick, above_cell = anchors[index - 1]
    below_pick, below_cell = anchors[index]
    return blend(above_cell, below_cell, _capital_curve_weight(position, above_pick, overall_pick, below_pick, curve))


def capital_shares(
    position: Position,
    overall_pick: int | None,
    priors: RookiePriors,
    features: RookieFeatures,
    curve: RookieCurvePriors,
) -> RookieShares:
    """`capitalShares`."""

    def blend(above: RookieShares, below: RookieShares, weight: float) -> RookieShares:
        def between(high: float, low: float) -> float:
            return high + (low - high) * weight

        return RookieShares(
            between(above.snap_share, below.snap_share),
            between(above.target_share, below.target_share),
            between(above.carry_share, below.carry_share),
            between(above.pass_attempt_share, below.pass_attempt_share),
        )

    return _along_the_capital_curve(
        priors.by_bucket[position], position, overall_pick, features.pick_curve, blend, curve
    )


def capital_game_rate(
    position: Position,
    overall_pick: int | None,
    priors: RookiePriors,
    features: RookieFeatures,
    curve: RookieCurvePriors,
) -> float:
    """`capitalGameRate`."""

    def blend(above: float, below: float, weight: float) -> float:
        return above + (below - above) * weight

    return _along_the_capital_curve(
        priors.game_rate[position], position, overall_pick, features.pick_curve, blend, curve
    )


def landing_multiplier(rookie: RookieInput, priors: RookiePriors) -> float:
    """`landingMultiplier`."""
    typical = priors.typical_incumbent_claim[rookie.position]
    if not (typical > 0):
        return 1.0
    raw = 1 - (rookie.incumbent_claim / typical - 1)
    return js_min(1 + priors.landing_bound, js_max(1 - priors.landing_bound, raw))


def rookie_opportunity(
    rookie: RookieInput, priors: RookiePriors, features: RookieFeatures, curve: RookieCurvePriors
) -> PredictedOpportunity:
    """`rookieOpportunity`: league team volume, capital shares (the landing term only when on)."""
    shares = capital_shares(rookie.position, rookie.overall_pick, priors, features, curve)
    multiplier = landing_multiplier(rookie, priors) if features.landing_spot else 1.0
    targets, carries, passes = priors.league_team_volume
    return PredictedOpportunity(
        player_id=rookie.player_id,
        snap_share=clamp_share(shares.snap_share * multiplier),
        target_share=clamp_share(shares.target_share * multiplier),
        carry_share=clamp_share(shares.carry_share * multiplier),
        pass_attempt_share=clamp_share(shares.pass_attempt_share),
        team_targets=targets,
        team_carries=carries,
        team_pass_attempts=passes,
    )


@dataclass(frozen=True, slots=True)
class RookieEvidenceKnot:
    pick: float
    n: int


def rookie_curve_evidence_n(
    position: Position, overall_pick: float, evidence: Mapping[Position, Sequence[RookieEvidenceKnot]]
) -> int:
    """`rookieCurveEvidenceN`: the observation count at the nearest fitted pick (first on a tie)."""
    if position not in CURVE_POSITIONS:
        return 0
    knots = evidence[position]
    if not knots:
        return 0
    nearest = knots[0]
    nearest_distance = abs(overall_pick - nearest.pick)
    for knot in knots:
        distance = abs(overall_pick - knot.pick)
        if distance < nearest_distance:
            nearest = knot
            nearest_distance = distance
    return nearest.n


def historical_rookie_expected_games(
    position: Position,
    overall_pick: int | None,
    team_games: float,
    by_bucket: Mapping[Position, Mapping[str, float]],
) -> float:
    """`historicalRookieExpectedGames`, with `teamGamesIn(season)` passed in."""
    if position not in CURVE_POSITIONS:
        return 0.0
    return by_bucket[position][draft_bucket_for(overall_pick)] * team_games
