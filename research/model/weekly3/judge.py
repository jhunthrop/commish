"""THE ROUND'S FIT: the rate refit and checked, the fit seasons read game by game, and the 166
stage-1 coefficients, the 12 red-zone slopes and the range fit on the fit population.

Preregistration section 2, "Fitted in this round, and nothing else": the fit population is round 2's
population definition on the fit seasons, players with a number. Stage 1 is fit on those of them
with a game this season before W (a player with none has no stage-1 inputs; his number is the
rate); the red-zone slopes and the range on all of them. Every week-W count and line is read through
the run's outcome reader (`outcomes.py`), whose ledger G5 reads. The rate is round 3's, refit on its
own seasons and refused unless it equals its record (`weekly2.judge.rate_priors`, section 6).
"""

import time
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final

import numpy as np
from sqlalchemy import Connection

from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.ros.judge import RoundFit as RateFit
from research.model.ros.model import FORMATS, cell
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2.band import Ranges, fit_ranges
from research.model.weekly2.designation import QUESTIONABLE, WITHHELD
from research.model.weekly2.factor import Elasticity, FactorRow, fit_elasticities
from research.model.weekly2.gates import Thresholds
from research.model.weekly2.judge import rate_priors
from research.model.weekly2.statistics import population
from research.model.weekly3.allowance import NO_EXPECTATION, NO_GAME
from research.model.weekly3.features import (
    CLUB_GAME_WITHOUT_PACE,
    FEWER_THAN_THREE,
    NO_FILING,
    NO_PRIOR_SEASON,
    TEAMMATE_NOT_IN_LAST_THREE,
)
from research.model.weekly3.ledger import Game, Stamp
from research.model.weekly3.number import Fitted, view_number
from research.model.weekly3.outcomes import LINE_WITHOUT_EDGE, GameOutcomeReader, Outcome
from research.model.weekly3.season import (
    NO_CLUB,
    NO_GAME_THIS_SEASON,
    NO_GAME_THIS_WEEK,
    Placed,
    SeasonRead,
    WeekRead,
    read_season,
)
from research.model.weekly3.stage import StageOne, club_means, fit_red_zone, fit_stage_one
from research.model.weekly3.work import KINDS_BY_POSITION, NO_RED_ZONE_ROW, NO_SNAP_ROW

FROZEN: Final = MappingProxyType
OUTSIDE_UNIVERSE: Final = "outside_the_universe"  # the missing-input table's last row: no m, no number
NO_PACE_AT_ALL: Final = "club_without_pace_takes_the_fit_mean"
FIRST_GAME_AFTER_A_TRADE: Final = "first_game_after_a_trade"
# Every row of the missing-input table, written into the counts at 0 when no row took it (section 2:
# "The results report the count of rows under each default").
DEFAULTS: Final = (
    NO_GAME_THIS_SEASON,
    NO_CLUB,
    NO_GAME_THIS_WEEK,
    FEWER_THAN_THREE,
    NO_PRIOR_SEASON,
    NO_RED_ZONE_ROW,
    NO_SNAP_ROW,
    CLUB_GAME_WITHOUT_PACE,
    NO_PACE_AT_ALL,
    NO_GAME,
    NO_EXPECTATION,
    TEAMMATE_NOT_IN_LAST_THREE,
    NO_FILING,
    OUTSIDE_UNIVERSE,
    LINE_WITHOUT_EDGE,
    FIRST_GAME_AFTER_A_TRADE,
    "withheld",
    "questionable",
    "withheld_at_thursday",
)


@dataclass(frozen=True, slots=True)
class Member:
    """One population player at one week: the model's view of him (None: outside its universe) and
    his outcome."""

    week: WeekRead
    player_id: str
    position: str
    placed: Placed | None
    outcome: Outcome


def members(read: SeasonRead, positions: Mapping[str, Position], t: Thresholds) -> list[Member]:
    """Every (week, position) population of the season, in a fixed order (round 2's definition)."""
    found: list[Member] = []
    for week in read.weeks:
        board = week.board
        lined = read.outcomes.get(board.week, {})
        to_date = {p.player_id: p.to_date for p in board.players if p.games > 0}
        for position in SKILL_POSITIONS:
            chosen = population(position, set(lined), board.adp, to_date, positions, t.population[position])
            found.extend(Member(week, pid, position, week.placed.get(pid), lined[pid]) for pid in sorted(chosen))
    return found


def is_numbered(placed: Placed | None) -> bool:
    """A number at his game's instant: in the universe, his club plays, not withheld."""
    return placed is not None and placed.moment is not None and placed.own.status != WITHHELD


def default_counts(rows: Iterable[Member]) -> dict[str, int]:
    """The rows under each missing-input default, the withheld and flagged rows, and the first games
    after a trade (section 5, "Reported, not gated")."""
    counts: Counter[str] = Counter(dict.fromkeys(DEFAULTS, 0))
    for m in rows:
        counts["rows"] += 1
        counts.update(m.outcome.defaults)
        placed = m.placed
        if placed is None:
            counts[OUTSIDE_UNIVERSE] += 1
            continue
        counts.update(placed.defaults)
        features = placed.own.features
        if features is not None:
            counts.update(features.defaults)
            counts[NO_PACE_AT_ALL] += features.pace is None or features.pass_rate is None
        if placed.moment is not None:
            counts["withheld"] += placed.own.status == WITHHELD
            counts["questionable"] += placed.own.status == QUESTIONABLE
            counts["withheld_at_thursday"] += placed.thursday.status == WITHHELD
        traded = placed.club is not None and m.outcome.club is not None and placed.club != m.outcome.club
        counts[FIRST_GAME_AFTER_A_TRADE] += traded
    return dict(sorted(counts.items()))


def vacated_club_games(reads: Iterable[SeasonRead]) -> int:
    """Club-games in which some player's vacated volume counted a withheld teammate."""
    found = {
        (read.season, week.board.week, placed.club)
        for read in reads
        for week in read.weeks
        for placed in week.placed.values()
        if placed.own.features is not None and placed.own.features.vacating > 0
    }
    return len(found)


def stage_one_error(rows: Sequence[Member], stage: StageOne) -> dict[str, dict[str, float | int]]:
    """Per position and kind: stage 1's RMSE and the season-to-date mean's, against the week's count."""
    found: dict[str, dict[str, float | int]] = {}
    for position, kinds in KINDS_BY_POSITION.items():
        kept = [
            (m.placed.own.features, m.outcome.work)
            for m in rows
            if m.position == position and m.placed is not None and m.placed.own.features is not None
        ]
        for kind in kinds:
            actual = np.array([w.of(kind) for _, w in kept], dtype=float)
            predicted = np.array([stage.predict(position, kind, f) for f, _ in kept], dtype=float)
            mean = np.array([f.season_mean.of(kind) for f, _ in kept], dtype=float)
            size = len(kept)
            found[f"{position}|{kind}"] = {
                "n": size,
                "stage_one": float(np.sqrt(np.mean((predicted - actual) ** 2))) if size else 0.0,
                "season_mean": float(np.sqrt(np.mean((mean - actual) ** 2))) if size else 0.0,
            }
    return found


@dataclass(frozen=True, slots=True)
class RoundFit:
    rate: RateFit
    fitted: Fitted
    ranges: Ranges
    elasticities: Mapping[str, Elasticity]  # the reported ablation's, round 2's factor refit here
    fit_rows: int
    stage_rows: int
    served: tuple[int, ...]
    board_moments: Mapping[int, str]
    stamps: tuple[Stamp, ...]
    games: tuple[Game, ...]
    reported: Mapping[str, Any]
    seconds: Mapping[str, float]


def _staged(numbered: Sequence[Member]) -> list[Member]:
    return [m for m in numbered if m.placed is not None and m.placed.own.features is not None]


def _fit_numbers(numbered: Sequence[Member], staged: Sequence[Member], rate: RateFit) -> Fitted:
    features = [m.placed.own.features for m in staged if m.placed is not None and m.placed.own.features is not None]
    fallback = club_means(features)
    stage = fit_stage_one(
        [
            (m.position, m.placed.own.features, m.outcome.work)
            for m in staged
            if m.placed is not None and m.placed.own.features is not None
        ],
        fallback,
    )
    opportunity = rate.priors.opportunity
    red_zone = {
        cell(p, name): fit_red_zone(
            [(m.outcome.points[name], m.outcome.work) for m in numbered if m.position == p], opportunity[cell(p, name)]
        )
        for p in SKILL_POSITIONS
        for name in FORMATS
    }
    return Fitted(stage, FROZEN(red_zone), opportunity)


def _range_pairs(numbered: Sequence[Member], fitted: Fitted) -> dict[str, list[tuple[float, float]]]:
    pairs: dict[str, list[tuple[float, float]]] = {cell(p, f): [] for p in SKILL_POSITIONS for f in FORMATS}
    for m in numbered:
        if m.placed is None:
            continue
        number = view_number(m.placed, m.placed.own, fitted)
        if number is not None:
            for name in FORMATS:
                pairs[cell(m.position, name)].append((number[name], m.outcome.points[name]))
    return pairs


def fit_round(
    conn: Connection,
    t: Thresholds,
    artifacts: ModelArtifacts,
    reader: GameOutcomeReader,
    positions: Mapping[str, Position],
) -> tuple[RoundFit, GameOutcomeReader]:
    started = time.monotonic()
    rate = rate_priors(conn, t, artifacts)
    rated = time.monotonic()
    reads: list[SeasonRead] = []
    for season in t.fit_seasons:
        read, reader = read_season(conn, season, t, rate.priors, artifacts, positions, reader)
        reads.append(read)
    collected = time.monotonic()
    fit_members = [m for read in reads for m in members(read, positions, t)]
    numbered = [m for m in fit_members if is_numbered(m.placed)]
    staged = _staged(numbered)
    fitted = _fit_numbers(numbered, staged, rate)
    ranges = fit_ranges(_range_pairs(numbered, fitted), t)
    elasticities = fit_elasticities(
        [
            FactorRow(
                m.position,
                m.placed.player.rate["ppr"],
                m.outcome.points["ppr"],
                m.placed.player.d_pass,
                m.placed.player.d_rush,
            )
            for m in numbered
            if m.placed is not None
        ],
        t.elasticity_grid,
    )
    reported = {
        "stage_one_error": stage_one_error(staged, fitted.stage),
        "counts": default_counts(fit_members),
        "club_games_with_vacated_volume": vacated_club_games(reads),
    }
    seconds = {"rate": rated - started, "read": collected - rated, "fit": time.monotonic() - collected}
    found = RoundFit(
        rate,
        fitted,
        ranges,
        elasticities,
        len(numbered),
        len(staged),
        (*rate.served, *reader.served),
        FROZEN({read.season: read.board_moment for read in reads}),
        tuple(s for read in reads for s in read.all_stamps),
        tuple(g for read in reads for g in read.games),
        FROZEN(reported),
        FROZEN(seconds),
    )
    return found, reader
