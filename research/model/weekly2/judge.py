"""THE ROUND, RUN: the rate refit and checked, the opponent factor and the range fit on the fit
seasons, then the judged weeks scored and every gate read.

`fit_round` refits round 3's rate on its own seasons and refuses unless it equals the judged record
(section 5's precondition), reads every fit week's board at its moment, fits the elasticities on the
fit population's PPR points and the range on the same rows. `judge_round` reads the judgment
season's weeks the same way and returns every preregistered and every reported number. Every
outcome passes through the run's readers (`guard`), whose ledgers G5 reads.
"""

import json
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final

from sqlalchemy import Connection

from research.errors import ConfigurationError
from research.model.arithmetic import ARM64_BOARDS
from research.model.domain import Position
from research.model.priors import ModelArtifacts
from research.model.ros.judge import RoundFit as RateFit
from research.model.ros.judge import fit_round as fit_rate
from research.model.ros.model import FORMATS
from research.model.ros.payload import priors_payload
from research.model.ros.reads import build_stale_board
from research.model.ros.ship import first_difference
from research.model.weekly.round.scoring import SKILL_POSITIONS
from research.model.weekly2.band import Ranges, fit_ranges
from research.model.weekly2.board import WeekBoard, WeekNumber, WeekPlayer, read_week, week_number
from research.model.weekly2.designation import WITHHELD
from research.model.weekly2.factor import Elasticity, FactorRow, fit_elasticities
from research.model.weekly2.gates import Thresholds
from research.model.weekly2.guard import WeekOutcomeReader, WeekOutcomes
from research.model.weekly2.statistics import (
    BoardRow,
    Contender,
    JudgedRow,
    population,
)

DOCS: Final = Path(__file__).resolve().parents[3] / "docs/research"
FROZEN: Final = MappingProxyType


def rate_priors(conn: Connection, t: Thresholds, artifacts: ModelArtifacts, record: Path | None = None) -> RateFit:
    """Round 3's rate refit on its own seasons, refused unless every number equals its record."""
    path = record or DOCS / t.rate_record
    if not path.exists():
        raise ConfigurationError(f"round 3's record {path.name} is not in this tree; the rate cannot be checked")
    fitted = fit_rate(conn, t.rate_round, artifacts, ARM64_BOARDS)
    judged = json.loads(path.read_text())["priors"]
    differs = first_difference(priors_payload(fitted.priors), judged)
    if differs is not None:
        raise ConfigurationError(
            f"round 3's rate refit on this store differs from {t.rate_record} at {differs!r}; refused"
        )
    return fitted


@dataclass(frozen=True, slots=True)
class SeasonRead:
    season: int
    boards: tuple[WeekBoard, ...]
    outcomes: WeekOutcomes
    board_moment: str


def read_season(  # noqa: PLR0913, PLR0917 - the reads one season needs
    conn: Connection,
    season: int,
    t: Thresholds,
    rate: RateFit,
    artifacts: ModelArtifacts,
    positions: Mapping[str, Position],
    reader: WeekOutcomeReader,
) -> tuple[SeasonRead, WeekOutcomeReader]:
    """The season's preseason board, its outcomes through the reader, and every judged week's inputs."""
    stale = build_stale_board(conn, season, artifacts, ARM64_BOARDS, t.rate_round.prior_source)
    outcomes, reader = reader.season(conn, season, positions)
    boards = tuple(read_week(conn, season, week, stale, positions, rate.priors, t.adp_source) for week in t.weeks)
    return SeasonRead(season, boards, outcomes, stale.moment.isoformat()), reader


@dataclass(frozen=True, slots=True)
class Member:
    """One population player at one week, with the model's view of him (None: outside its universe)."""

    board: WeekBoard
    player_id: str
    position: str
    player: WeekPlayer | None
    actual: Mapping[str, float]


def members(read: SeasonRead, positions: Mapping[str, Position], t: Thresholds) -> list[Member]:
    """Every (week, position) population of the season, in a fixed order."""
    found: list[Member] = []
    for board in read.boards:
        lined = read.outcomes.get(board.week, {})
        by_id = {p.player_id: p for p in board.players}
        to_date = {p.player_id: p.to_date for p in board.players if p.games > 0}
        for position in SKILL_POSITIONS:
            chosen = population(position, set(lined), board.adp, to_date, positions, t.population[position])
            found.extend(Member(board, pid, position, by_id.get(pid), lined[pid]) for pid in sorted(chosen))
    return found


def _number(member: Member, elasticities: Mapping[str, Elasticity], t: Thresholds, version: str) -> WeekNumber | None:
    if member.player is None:
        return None
    return week_number(member.board, member.player, elasticities, t.model_name, version)


@dataclass(frozen=True, slots=True)
class RoundFit:
    rate: RateFit
    elasticities: Mapping[str, Elasticity]
    ranges: Ranges
    fit_rows: int
    served: tuple[int, ...]
    board_moments: Mapping[int, str]
    seconds: Mapping[str, float]


def fit_round(  # noqa: PLR0913, PLR0917 - the fit's every input, named
    conn: Connection,
    t: Thresholds,
    artifacts: ModelArtifacts,
    reader: WeekOutcomeReader,
    positions: Mapping[str, Position],
    version: str,
) -> RoundFit:
    started = time.monotonic()
    rate = rate_priors(conn, t, artifacts)
    rated = time.monotonic()
    reads: list[SeasonRead] = []
    for season in t.fit_seasons:
        read, reader = read_season(conn, season, t, rate, artifacts, positions, reader)
        reads.append(read)
    collected = time.monotonic()
    fit_members = [m for read in reads for m in members(read, positions, t) if m.player is not None]
    numbered = [m for m in fit_members if m.player is not None and m.player.status != WITHHELD]
    elasticities = fit_elasticities(
        [
            FactorRow(m.player.position, m.player.rate["ppr"], m.actual["ppr"], m.player.d_pass, m.player.d_rush)
            for m in numbered
            if m.player is not None
        ],
        t.elasticity_grid,
    )
    pairs: dict[str, list[tuple[float, float]]] = {f"{p}|{f}": [] for p in SKILL_POSITIONS for f in FORMATS}
    for m in numbered:
        found = _number(m, elasticities, t, version)
        if found is not None and found.number is not None:
            for name in FORMATS:
                pairs[f"{found.position}|{name}"].append((found.number[name], m.actual[name]))
    ranges = fit_ranges(pairs, t)
    seconds = {"rate": rated - started, "read": collected - rated, "fit": time.monotonic() - collected}
    return RoundFit(
        rate,
        elasticities,
        ranges,
        len(numbered),
        reader.served,
        FROZEN({read.season: read.board_moment for read in reads}),
        FROZEN(seconds),
    )


@dataclass(frozen=True, slots=True)
class Scored:
    """The judgment season scored: the population rows, the whole board's rows, and the contenders
    for the chance, by (week, position) and format."""

    rows: tuple[JudgedRow, ...]
    board: tuple[BoardRow, ...]
    contenders: Mapping[tuple[int, str, str], tuple[Contender, ...]]
    numbers: tuple[WeekNumber, ...]


def _judged_row(member: Member, number: WeekNumber | None) -> JudgedRow:
    player = member.player
    return JudgedRow(
        member.board.week,
        member.player_id,
        member.position,
        None if number is None else number.number,
        None if player is None else player.rate,
        None if player is None else player.board,
        member.board.adp.get(member.player_id),
        member.board.form.get(member.player_id),
        member.actual,
        number is not None and number.questionable,
    )


def _whole_board(
    read: SeasonRead, fitted: RoundFit, t: Thresholds, version: str
) -> tuple[list[WeekNumber], list[BoardRow]]:
    numbers: list[WeekNumber] = []
    rows: list[BoardRow] = []
    for board in read.boards:
        lined = read.outcomes.get(board.week, {})
        for player in board.players:
            found = week_number(board, player, fitted.elasticities, t.model_name, version)
            numbers.append(found)
            if found.number is not None and player.player_id in lined:
                rows.append(BoardRow(player.position, found.number, lined[player.player_id]))
    return numbers, rows


def score_season(
    read: SeasonRead, fitted: RoundFit, positions: Mapping[str, Position], t: Thresholds, version: str
) -> Scored:
    numbers, board_rows = _whole_board(read, fitted, t, version)
    by_key = {(n.week, n.player_id): n for n in numbers}
    rows: list[JudgedRow] = []
    contenders: dict[tuple[int, str, str], list[Contender]] = {}
    for member in members(read, positions, t):
        number = by_key.get((member.board.week, member.player_id))
        rows.append(_judged_row(member, number))
        if number is None or number.number is None:
            continue
        for name in FORMATS:
            offsets = fitted.ranges.offsets(number.position, name, number.number[name])
            contender = Contender(member.player_id, number.number[name], offsets, member.actual[name])
            contenders.setdefault((member.board.week, member.position, name), []).append(contender)
    return Scored(
        tuple(rows),
        tuple(board_rows),
        FROZEN({key: tuple(found) for key, found in contenders.items()}),
        tuple(numbers),
    )


def elasticities_payload(elasticities: Mapping[str, Elasticity]) -> dict[str, Any]:
    return {position: {"pass": e.passing, "rush": e.rushing} for position, e in elasticities.items()}
