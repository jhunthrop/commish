"""LAYER 1, OPPORTUNITY: each player's predicted shares of his team's work, and the team's volume.

Ported from `research-ts/src/projections/model/opportunity.ts` and the rolling means of
`features/opportunity.ts`. Shrinkage toward the role prior, the prior season first and this
season's form second, exactly as the TypeScript nests it.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import Final

from research.model.domain import Position
from research.model.jsmath import js_max, js_min, js_pow
from research.model.reads.observations import LAST_POSSIBLE_WEEK, PlayerWeekUsage

RECENCY_DECAY_DEFAULT: Final = 0.75
_WINDOW: Final = LAST_POSSIBLE_WEEK


@dataclass(frozen=True, slots=True)
class WeeklyValue:
    week: int
    value: float | None


def rolling_opportunity(
    history: Sequence[WeeklyValue], window: int, decay: float, anchor_week: int | None
) -> float | None:
    """`rollingOpportunity`: a recency-weighted mean over the window ending at the anchor week."""
    if window < 1:
        raise ValueError(f"A rolling window must be a positive whole number of weeks; got {window}.")
    if not (0 < decay <= 1):
        raise ValueError(f"A recency decay must be greater than 0 and at most 1; got {decay}.")
    known = [entry for entry in history if entry.value is not None]
    if not known:
        return None
    anchor = anchor_week if anchor_week is not None else js_max(*(float(entry.week) for entry in known))
    weighted = 0.0
    weights = 0.0
    for entry in known:
        weeks_ago = anchor - entry.week
        if weeks_ago < 0 or weeks_ago >= window:
            continue
        weight = js_pow(decay, weeks_ago)
        value = entry.value
        if value is None or value != value or value < 0 or value in (float("inf"), float("-inf")):
            raise ValueError(f"week {entry.week} value must be a finite, non-negative number; got {value}.")
        weighted += weight * value
        weights += weight
    return None if weights == 0 else weighted / weights


def rolling_weight(history: Sequence[WeeklyValue], window: int, decay: float, anchor_week: int | None) -> float:
    """`rollingWeight`: the total weight `rolling_opportunity` would have divided by."""
    known = [entry for entry in history if entry.value is not None]
    if not known:
        return 0.0
    anchor = anchor_week if anchor_week is not None else js_max(*(float(entry.week) for entry in known))
    weights = 0.0
    for entry in known:
        weeks_ago = anchor - entry.week
        if weeks_ago < 0 or weeks_ago >= window:
            continue
        weights += js_pow(decay, weeks_ago)
    return weights


@dataclass(frozen=True, slots=True)
class RolePrior:
    snap_share: float
    targets_per_snap: float
    carries_per_snap: float
    pass_attempts_per_snap: float


@dataclass(frozen=True, slots=True)
class OpportunityShrinkage:
    season: float
    in_season: float
    team_volume: float


@dataclass(frozen=True, slots=True)
class LeagueTeamVolume:
    targets: float
    carries: float
    pass_attempts: float


@dataclass(frozen=True, slots=True)
class ShareShrinkage:
    season: float | None = None
    in_season: float | None = None


@dataclass(frozen=True, slots=True)
class OpportunityPriors:
    recency_decay: float
    by_position: Mapping[Position, RolePrior]
    shrinkage: OpportunityShrinkage
    league_team_volume: LeagueTeamVolume
    share_shrinkage_by_position: Mapping[Position, ShareShrinkage] = field(default_factory=lambda: MappingProxyType({}))


def _share_shrinkage_for(priors: OpportunityPriors, position: Position) -> OpportunityShrinkage:
    override = priors.share_shrinkage_by_position.get(position)
    if override is None:
        return priors.shrinkage
    return OpportunityShrinkage(
        priors.shrinkage.season if override.season is None else override.season,
        priors.shrinkage.in_season if override.in_season is None else override.in_season,
        priors.shrinkage.team_volume,
    )


@dataclass(frozen=True, slots=True)
class PredictedOpportunity:
    player_id: str
    snap_share: float
    target_share: float
    carry_share: float
    pass_attempt_share: float
    team_targets: float
    team_carries: float
    team_pass_attempts: float

    def but(self, **changes: float) -> "PredictedOpportunity":
        return replace(self, **changes)


def clamp_share(value: float) -> float:
    return js_min(1.0, js_max(0.0, value))


def _shrink(estimate: float | None, weight: float, prior: float, k: float) -> float:
    if estimate is None or weight <= 0:
        return prior
    return (weight * estimate + k * prior) / (weight + k)


@dataclass(frozen=True, slots=True)
class _History:
    prior_season: tuple[PlayerWeekUsage, ...]
    this_season: tuple[PlayerWeekUsage, ...]


def _weekly(rows: Sequence[PlayerWeekUsage], read: Callable[[PlayerWeekUsage], float | None]) -> list[WeeklyValue]:
    return [WeeklyValue(row.week, read(row)) for row in rows]


def _level(rows: list[WeeklyValue], decay: float, anchor: int) -> tuple[float | None, float]:
    return rolling_opportunity(rows, _WINDOW, decay, anchor), rolling_weight(rows, _WINDOW, decay, anchor)


def _predict_share(
    history: _History,
    read: Callable[[PlayerWeekUsage], float | None],
    role_prior: float,
    shrinkage: OpportunityShrinkage,
    priors: OpportunityPriors,
    week: int,
) -> float:
    prior_mean, prior_games = _level(_weekly(history.prior_season, read), 1.0, LAST_POSSIBLE_WEEK)
    level1 = _shrink(prior_mean, prior_games, role_prior, shrinkage.season)
    form, form_games = _level(_weekly(history.this_season, read), priors.recency_decay, week)
    return clamp_share(_shrink(form, form_games, level1, shrinkage.in_season))


def _volume_or_none(value: float | None) -> float | None:
    return None if value == 0 else value


def _predict_volume(
    history: _History,
    read: Callable[[PlayerWeekUsage], float | None],
    league_mean: float,
    priors: OpportunityPriors,
    week: int,
) -> float:
    def volume(row: PlayerWeekUsage) -> float | None:
        return _volume_or_none(read(row))

    prior_mean, prior_games = _level(_weekly(history.prior_season, volume), 1.0, LAST_POSSIBLE_WEEK)
    level1 = _shrink(prior_mean, prior_games, league_mean, priors.shrinkage.team_volume)
    form, form_games = _level(_weekly(history.this_season, volume), priors.recency_decay, week)
    return js_max(0.0, _shrink(form, form_games, level1, priors.shrinkage.team_volume))


def predict_opportunity(
    history: Sequence[PlayerWeekUsage],
    season: int,
    week: int,
    positions: Mapping[str, Position],
    priors: OpportunityPriors,
) -> dict[str, PredictedOpportunity]:
    """`predictOpportunity`: every player with usage in the two seasons, in sorted id order."""
    by_player: dict[str, tuple[list[PlayerWeekUsage], list[PlayerWeekUsage]]] = {}
    for row in history:
        if row.season == season and row.week >= week:
            continue
        if row.season > season or row.season < season - 1:
            continue
        entry = by_player.setdefault(row.player_id, ([], []))
        (entry[1] if row.season == season else entry[0]).append(row)
    predictions: dict[str, PredictedOpportunity] = {}
    for player_id in sorted(by_player):
        position = positions.get(player_id)
        if position is None:
            continue
        role = priors.by_position[position]
        prior_rows, this_rows = by_player[player_id]
        history_of = _History(tuple(prior_rows), tuple(this_rows))
        shrinkage = _share_shrinkage_for(priors, position)
        snap = _predict_share(history_of, lambda r: r.snap_share, role.snap_share, shrinkage, priors, week)
        predictions[player_id] = PredictedOpportunity(
            player_id=player_id,
            snap_share=snap,
            target_share=_predict_share(
                history_of, lambda r: r.target_share, clamp_share(role.targets_per_snap * snap), shrinkage, priors, week
            ),
            carry_share=_predict_share(
                history_of, lambda r: r.carry_share, clamp_share(role.carries_per_snap * snap), shrinkage, priors, week
            ),
            pass_attempt_share=_predict_share(
                history_of,
                lambda r: r.pass_attempt_share,
                clamp_share(role.pass_attempts_per_snap * snap),
                shrinkage,
                priors,
                week,
            ),
            team_targets=_predict_volume(
                history_of, lambda r: r.team_targets, priors.league_team_volume.targets, priors, week
            ),
            team_carries=_predict_volume(
                history_of, lambda r: r.team_carries, priors.league_team_volume.carries, priors, week
            ),
            team_pass_attempts=_predict_volume(
                history_of, lambda r: r.team_pass_attempts, priors.league_team_volume.pass_attempts, priors, week
            ),
        )
    return predictions
