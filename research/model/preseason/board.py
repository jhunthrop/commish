"""THE PRESEASON BOARD: candidates scaled to a season, banded, valued, tiered and explained.

Ported from `research-ts/src/projections/preseason/{board,game-variance}.ts` (the applying half).
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Any, Final

from research.model.decide.value import (
    LeagueShape,
    SeasonProjection,
    ValuedPlayer,
    is_real_tier_cliff,
    tier_standings,
    tiers_of,
    value_board,
)
from research.model.domain import STAT_FIELDS, Position, ScoringRules, StatLine, compute_fantasy_points
from research.model.jsmath import js_max, js_or, js_sorted, locale_compare
from research.model.preseason.availability import GamesPlayedOutlook, ProjectionDistribution
from research.model.preseason.candidates import BoardCandidate, Reason

Z90: Final = 1.2815515655446004
VARIANCE_POSITIONS: Final = ("QB", "RB", "WR", "TE", "K", "DEF")
_SCALED_OPTIONAL_FIELDS: Final = (
    "two_point_conversions",
    "field_goals_missed",
    "extra_points_missed",
    "kick_return_touchdowns",
    "punt_return_touchdowns",
    "defensive_fumbles_recovered",
    "safeties",
)
GameVariancePriors = Mapping[str, Mapping[str, float]]


def scale_stat_line(line: StatLine, games: float) -> StatLine:
    """`scaleStatLine`: a per-game line times a number of games (absent optional fields stay absent)."""
    if not (games >= 0) or not math.isfinite(games):
        raise ValueError(f"A season line is a per-game line times a finite number of games; got {games}.")
    scaled: dict[str, float | None] = {name: getattr(line, name) * games for name in STAT_FIELDS}
    for name in _SCALED_OPTIONAL_FIELDS:
        value = getattr(line, name)
        if value is not None:
            scaled[name] = value * games
    changes: dict[str, Any] = dict(scaled)
    return replace(line, **changes)


def season_points_interval(
    per_game_points: float,
    games: GamesPlayedOutlook,
    per_game_variance: float,
    z: float,
    projection_error_variance: float = 0.0,
) -> ProjectionDistribution:
    """`seasonPointsInterval`."""
    mean_season = per_game_points * games.expected
    games_variance = 0.0
    for count, probability in enumerate(games.probabilities):
        deviation = count - games.expected
        games_variance += probability * (deviation * deviation)
    season_variance = (
        games.expected * per_game_variance
        + games_variance * (per_game_points * per_game_points)
        + js_max(0.0, projection_error_variance)
    )
    sd = math.sqrt(js_max(0.0, season_variance))
    return ProjectionDistribution(js_max(0.0, mean_season - z * sd), mean_season, mean_season + z * sd)


def _game_variance_for(candidate: BoardCandidate, priors: GameVariancePriors) -> float:
    if candidate.position not in VARIANCE_POSITIONS:
        return 0.0
    rookie = any(reason["code"] == "rookie" for reason in candidate.reasons)
    return priors["rookie" if rookie else "veteran"].get(candidate.position, 0.0)


@dataclass(frozen=True, slots=True)
class BoardEntry:
    player_id: str
    position: Position
    projected_points: float
    value_over_replacement: float
    position_rank: int
    replacement_level: float
    rank: int
    value_rank: int
    team: str
    expected_games: float
    season_line: StatLine
    outlook: ProjectionDistribution
    tier: int
    players_left_in_tier: int
    drop_to_next_tier: float
    reasons: tuple[Reason, ...]


def preseason_board(
    candidates: Sequence[BoardCandidate], rules: ScoringRules, shape: LeagueShape, game_variance: GameVariancePriors
) -> list[BoardEntry]:
    """`preseasonBoard`."""
    held: dict[str, tuple[BoardCandidate, StatLine, ProjectionDistribution]] = {}
    projections: list[SeasonProjection] = []
    for candidate in candidates:
        tier_points = candidate.per_game_tier_points or 0.0
        season_line = scale_stat_line(candidate.per_game, candidate.games.expected)
        per_game_points = compute_fantasy_points(candidate.per_game, candidate.position, rules) + tier_points
        projected = (
            compute_fantasy_points(season_line, candidate.position, rules) + tier_points * candidate.games.expected
        )
        outlook = season_points_interval(
            per_game_points,
            candidate.games,
            _game_variance_for(candidate, game_variance),
            Z90,
            candidate.season_projection_error_variance or 0.0,
        )
        held[candidate.player_id] = (candidate, season_line, outlook)
        projections.append(SeasonProjection(candidate.player_id, candidate.position, projected))
    valued = value_board(projections, shape)
    value_ranks = {player.player_id: index + 1 for index, player in enumerate(valued)}
    standings: dict[str, tuple[int, int, float]] = {}
    for position in dict.fromkeys(player.position for player in valued):
        pool = [player for player in valued if player.position == position]
        tiers = tiers_of([player.projected_points for player in pool])
        for player, tier, (left, drop) in zip(
            pool, tiers, tier_standings(tiers, [p.value_over_replacement for p in pool]), strict=True
        ):
            standings[player.player_id] = (tier, left, drop)
    ordered = js_sorted(
        valued,
        lambda a, b: js_or(b.projected_points - a.projected_points, lambda: locale_compare(a.player_id, b.player_id)),
    )
    return [_entry(player, index, value_ranks, held, standings) for index, player in enumerate(ordered)]


def _entry(
    player: ValuedPlayer,
    index: int,
    value_ranks: Mapping[str, int],
    held: Mapping[str, tuple[BoardCandidate, StatLine, ProjectionDistribution]],
    standings: Mapping[str, tuple[int, int, float]],
) -> BoardEntry:
    candidate, season_line, outlook = held[player.player_id]
    tier, left, drop = standings[player.player_id]
    reasons: list[Reason] = [
        *candidate.reasons,
        {"code": "scarcity", "positionRank": player.position_rank, "replacementLevel": player.replacement_level},
    ]
    if is_real_tier_cliff(player.projected_points, drop):
        reasons.append({"code": "tier_cliff", "playersLeftInTier": left, "dropToNextTier": drop})
    return BoardEntry(
        player.player_id,
        player.position,
        player.projected_points,
        player.value_over_replacement,
        player.position_rank,
        player.replacement_level,
        index + 1,
        value_ranks[player.player_id],
        candidate.team,
        candidate.games.expected,
        season_line,
        outlook,
        tier,
        left,
        drop,
        tuple(reasons),
    )
