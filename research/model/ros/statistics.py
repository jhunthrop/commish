"""THE ROUND'S STATISTICS: the population, rank agreement with the rest of the season, the
starters' rank error, and the interval's coverage.

The population of a (week, position, format) is the union of the stale board's top K and the top K
by points so far, defined without the model. Every source is scored on the same players; a player a
source has no opinion on ranks below every player it has (`NO_OPINION`). Ranks are average ranks,
highest first.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Final

from research.model.backtest import Observation, _average_ranks, spearman
from research.model.domain import Position
from research.model.ros.gates import CellScore, Coverage
from research.model.ros.model import FORMATS, PlayerToDate
from research.model.weekly.round.scoring import SKILL_POSITIONS

NO_OPINION: Final = -1.0
SOURCES: Final = ("model", "board", "form", "ecr")


def _top(scored: Mapping[str, float], size: int) -> list[str]:
    return [player_id for player_id, _ in sorted(scored.items(), key=lambda item: (-item[1], item[0]))[:size]]


def population(players: Sequence[PlayerToDate], position: str, format_name: str, size: int) -> frozenset[str]:
    """The stale board's top `size` at the position, with the top `size` by points so far."""
    at = [p for p in players if p.position == position]
    board = {p.player_id: p.stale.projected[format_name] for p in at if p.stale is not None}
    so_far = {p.player_id: sum(g.points[format_name] for g in p.played) for p in at if p.played}
    return frozenset(_top(board, size)) | frozenset(_top(so_far, size))


def population_formats(
    players: Sequence[PlayerToDate], sizes: Mapping[str, int]
) -> list[tuple[PlayerToDate, frozenset[str]]]:
    """Each player in a population, with the formats whose population holds him: the one rule the fit
    and the judgment share."""
    pops = {(p, f): population(players, p, f, sizes[p]) for p in SKILL_POSITIONS for f in FORMATS}
    found = []
    for player in players:
        formats = frozenset(f for f in FORMATS if player.player_id in pops[(player.position, f)])
        if formats:
            found.append((player, formats))
    return found


@dataclass(frozen=True, slots=True)
class JudgedRow:
    """One player at one judged week: every source's view and the outcome, in each format."""

    week: int
    player_id: str
    position: Position
    model: Mapping[str, float]
    floor: Mapping[str, float] | None  # None: a round with no interval (round 3)
    median: Mapping[str, float] | None
    ceiling: Mapping[str, float] | None
    board: Mapping[str, float] | None
    form: Mapping[str, float] | None
    ecr: float | None
    actual: Mapping[str, float]
    expected_games: float
    actual_games: int
    in_population: frozenset[str]


Score = Callable[[JudgedRow], float]


def _scores(format_name: str) -> dict[str, Score]:
    def model(row: JudgedRow) -> float:
        return row.model[format_name]

    def board(row: JudgedRow) -> float:
        return NO_OPINION if row.board is None else row.board[format_name]

    def form(row: JudgedRow) -> float:
        return NO_OPINION if row.form is None else row.form[format_name]

    def ecr(row: JudgedRow) -> float:
        return -1e9 if row.ecr is None else -row.ecr

    return {"model": model, "board": board, "form": form, "ecr": ecr}


def _ranks_desc(values: Sequence[float]) -> list[float]:
    return _average_ranks([-value for value in values])


def cell_rows(rows: Sequence[JudgedRow], week: int, position: str, format_name: str) -> list[JudgedRow]:
    return [r for r in rows if r.week == week and r.position == position and format_name in r.in_population]


@dataclass(frozen=True, slots=True)
class CellReport:
    size: int
    rho: Mapping[str, float | None]
    rank_error: Mapping[str, float | None]


def cell_report(cell: Sequence[JudgedRow], format_name: str, starters: int) -> CellReport:
    """Every source's rho and starters' rank error on one cell's population."""
    actual = [row.actual[format_name] for row in cell]
    actual_ranks = _ranks_desc(actual)
    top = [i for i, rank in enumerate(actual_ranks) if rank <= starters]
    rho: dict[str, float | None] = {}
    errors: dict[str, float | None] = {}
    for source, score in _scores(format_name).items():
        values = [score(row) for row in cell]
        rho[source] = spearman([Observation(v, a) for v, a in zip(values, actual, strict=True)])
        ranks = _ranks_desc(values)
        errors[source] = sum(abs(ranks[i] - actual_ranks[i]) for i in top) / len(top) if top else None
    return CellReport(len(cell), rho, errors)


def cell_score(report: CellReport) -> CellScore:
    return CellScore(
        report.size, report.rho["model"], report.rho["board"], report.rank_error["model"], report.rank_error["board"]
    )


def coverage(cell: Sequence[JudgedRow], format_name: str) -> Coverage:
    """The share inside [floor, ceiling]; a round with no interval covers nothing (size 0)."""
    bands = [
        (r.floor[format_name], r.actual[format_name], r.ceiling[format_name]) for r in cell if r.floor and r.ceiling
    ]
    return Coverage(sum(1 for low, actual, high in bands if low <= actual <= high), len(bands))


def points_error(cell: Sequence[JudgedRow], format_name: str) -> float | None:
    if not cell:
        return None
    return sum(abs(r.model[format_name] - r.actual[format_name]) for r in cell) / len(cell)
