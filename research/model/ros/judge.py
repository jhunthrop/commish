"""THE ROUND, RUN: the fit on its seasons, then the judged weeks scored and every gate read.

`fit_round` fits every number on the preregistered seasons through a reader that refuses the judgment
season. `judge_round` builds the judgment season's stale board, projects each judged week at its
moment, reads the rest of the season once, and returns every preregistered and reported number.
The store is only read; G4 checks that by digest and by the readers' ledgers.
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection

from research.model.arithmetic import Arithmetic
from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.reads.preseason import all_positions, preseason_rankings_as_of
from research.model.register.freeze import ECR_SOURCE
from research.model.ros import gates
from research.model.ros.fit import FitRow, collect, fit_opportunity, fit_priors
from research.model.ros.model import FORMATS, PlayerToDate, RosPriors, interval, project, season_rate
from research.model.ros.outcomes import SeasonOutcomes, fit_reader, judgment_reader
from research.model.ros.reads import StaleBoard, build_stale_board, week_inputs
from research.model.ros.statistics import (
    JudgedRow,
    cell_report,
    cell_rows,
    cell_score,
    coverage,
    points_error,
    population,
)
from research.model.weekly.round.judge import table_digests
from research.model.weekly.round.scoring import SKILL_POSITIONS

FROZEN: Final = MappingProxyType


@dataclass(frozen=True, slots=True)
class RoundFit:
    priors: RosPriors
    rows: int
    served: tuple[int, ...]
    seconds: Mapping[str, float]


def fit_round(conn: Connection, t: gates.Thresholds, artifacts: ModelArtifacts, arithmetic: Arithmetic) -> RoundFit:
    started = time.monotonic()
    positions = all_positions(conn)
    reader = fit_reader(t.judgment_season)
    opportunity = fit_opportunity(conn, t.opportunity_seasons, positions, reader)
    lined = time.monotonic()
    rows: list[FitRow] = []
    for season in t.fit_seasons:
        stale = build_stale_board(conn, season, artifacts, arithmetic, t.prior_source)
        rows.extend(collect(conn, season, stale, positions, reader, t))
    read = time.monotonic()
    priors = fit_priors(rows, opportunity, t)
    seconds = {"opportunity": lined - started, "collect": read - lined, "search": time.monotonic() - read}
    return RoundFit(priors, len(rows), tuple(reader.served), FROZEN(seconds))


def _judged_row(  # noqa: PLR0913, PLR0917 - one player's every view at one judged week
    player: PlayerToDate,
    week: int,
    priors: RosPriors,
    outcomes: SeasonOutcomes,
    ecr: Mapping[str, float],
    in_population: frozenset[str],
) -> JudgedRow:
    projection = project(player, priors)
    bands = {name: interval(projection.projected[name], player.position, name, week, priors) for name in FORMATS}
    actual, games = outcomes.rest_of_season(player.player_id, week)
    form = (
        None
        if not player.played
        else FROZEN({name: (season_rate(player, name) or 0.0) * player.remaining for name in FORMATS})
    )
    return JudgedRow(
        week,
        player.player_id,
        player.position,
        projection.projected,
        FROZEN({name: band[0] for name, band in bands.items()}),
        FROZEN({name: band[1] for name, band in bands.items()}),
        FROZEN({name: band[2] for name, band in bands.items()}),
        None if player.stale is None else player.stale.projected,
        form,
        ecr.get(player.player_id),
        FROZEN(actual),
        projection.expected_games,
        games,
        in_population,
    )


def _week_rows(  # noqa: PLR0913, PLR0917 - the reads one judged week needs
    conn: Connection,
    t: gates.Thresholds,
    week: int,
    stale: StaleBoard,
    positions: Mapping[str, Position],
    priors: RosPriors,
    outcomes: SeasonOutcomes,
) -> list[JudgedRow]:
    inputs = week_inputs(conn, t.judgment_season, week, stale, positions)
    ecr = {r.player_id: r.rank for r in preseason_rankings_as_of(conn, t.judgment_season, ECR_SOURCE, inputs.moment)}
    pops = {(p, f): population(inputs.players, p, f, t.population[p]) for p in SKILL_POSITIONS for f in FORMATS}
    rows = []
    for player in inputs.players:
        formats = frozenset(f for f in FORMATS if player.player_id in pops[(player.position, f)])
        if formats:
            rows.append(_judged_row(player, week, priors, outcomes, ecr, formats))
    return rows


@dataclass(frozen=True, slots=True)
class Judgment:
    lines: tuple[gates.GateLine, ...]
    passed: bool
    numbers: Mapping[str, Any]


def _reported(rows: Sequence[JudgedRow], t: gates.Thresholds) -> tuple[dict[str, Any], dict[str, gates.CellScore]]:
    cells: dict[str, Any] = {}
    scores: dict[str, gates.CellScore] = {}
    for week in t.judgment_weeks:
        for position in SKILL_POSITIONS:
            for name in FORMATS:
                key = gates.cell_key(week, position, name)
                found = cell_rows(rows, week, position, name)
                report = cell_report(found, name, t.starters[position])
                scores[key] = cell_score(report)
                cells[key] = {
                    **asdict(report),
                    "coverage": asdict(coverage(found, name)),
                    "points_mae": points_error(found, name),
                }
    return cells, scores


def _pooled_coverage(rows: Sequence[JudgedRow], t: gates.Thresholds) -> dict[str, gates.Coverage]:
    pooled: dict[str, gates.Coverage] = {}
    for position in SKILL_POSITIONS:
        for name in FORMATS:
            parts = [coverage(cell_rows(rows, w, position, name), name) for w in t.judgment_weeks]
            pooled[f"{position}|{name}"] = gates.Coverage(sum(p.inside for p in parts), sum(p.size for p in parts))
    return pooled


def judge_round(
    conn: Connection, t: gates.Thresholds, fitted: RoundFit, artifacts: ModelArtifacts, arithmetic: Arithmetic
) -> Judgment:
    before = table_digests(conn)
    positions = all_positions(conn)
    reader = judgment_reader()
    stale = build_stale_board(conn, t.judgment_season, artifacts, arithmetic, t.prior_source)
    outcomes = reader.season(conn, t.judgment_season, positions)
    rows = [
        r for week in t.judgment_weeks for r in _week_rows(conn, t, week, stale, positions, fitted.priors, outcomes)
    ]
    after = table_digests(conn)
    cells, scores = _reported(rows, t)
    pooled = _pooled_coverage(rows, t)
    gated = {key: gates.Coverage(**cells[key]["coverage"]) for key in cells} if t.coverage_per_week else pooled
    allowed = (*t.opportunity_seasons, *t.fit_seasons, t.judgment_season)
    served = (*fitted.served, *reader.served)
    lines = [*gates.judged_lines(scores, gated, t), gates.isolation_line(served, allowed, before, after)]
    numbers = {
        "season": t.judgment_season,
        "weeks": list(t.judgment_weeks),
        "stale_board_moment": stale.moment.isoformat(),
        "stale_board_players": len(stale.players),
        "rows": len(rows),
        "cells": cells,
        "coverage_pooled": {key: asdict(found) for key, found in pooled.items()},
        "coverage_gated": {key: asdict(found) for key, found in gated.items()},
        "outcome_seasons_read": list(served),
        "digests": {"before": before, "after": after},
    }
    return Judgment(tuple(lines), gates.verdict(lines), FROZEN(numbers))
