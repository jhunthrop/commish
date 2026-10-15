"""THE TWO STAGES AND THE NUMBER: expected work for a game, its points, and x against the neutral
game.

Preregistration section 2. Stage 1 (item 2): per position, one ordinary least-squares line with an
intercept and no penalty per kind (17 lines, 10 coefficients each and 9 for snap share, 166 in all),
fit on counts. Stage 2 (item 4): O_f(E) = L_p,f(E's targets, carries, pass attempts, snap share) +
delta_p,f x (E's red-zone opportunities), L the rest-of-season model's opportunity line, unchanged,
and delta the slope of an ordinary least-squares line with an intercept of (actual points minus L at
actual usage) on actual red-zone opportunities, per position and format (12 numbers);
non-quarterbacks' expected pass attempts are their season-to-date mean. The number (item 5):
x_g,f = max(0, m_f + O_f(E_g) - O_f(E_n)), E_n stage 1's prediction for the neutral game.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Final

import numpy as np

from research.model.ros.model import OpportunityLine
from research.model.weekly3.features import Features, neutral
from research.model.weekly3.work import KINDS_BY_POSITION, PASS_ATTEMPTS, SNAP_SHARE, Kind, Work

COLUMNS: Final = (
    "intercept",
    "season_mean",
    "last_three",
    "prior",
    "no_prior",
    "vacated",
    "pace",
    "pass_rate",
    "allowance",
    "home",
)
SNAP_COLUMNS: Final = tuple(c for c in COLUMNS if c != "allowance")  # snap share reads no allowance


def columns_for(kind: Kind) -> tuple[str, ...]:
    return SNAP_COLUMNS if kind == SNAP_SHARE else COLUMNS


@dataclass(frozen=True, slots=True)
class ClubMeans:
    """The fit population's mean pace and pass rate: a club with none takes them."""

    pace: float
    pass_rate: float


def club_means(rows: Sequence[Features]) -> ClubMeans:
    paces = [f.pace for f in rows if f.pace is not None]
    rates = [f.pass_rate for f in rows if f.pass_rate is not None]
    if not paces or not rates:
        raise ValueError("no fit-population row carries a pace and a pass rate")
    return ClubMeans(sum(paces) / len(paces), sum(rates) / len(rates))


def design(f: Features, kind: Kind, fallback: ClubMeans) -> tuple[float, ...]:
    """One game's row for the `kind` line, in `columns_for(kind)`'s order."""
    values = {
        "intercept": 1.0,
        "season_mean": f.season_mean.of(kind),
        "last_three": f.last_three.of(kind),
        "prior": f.prior.of(kind),
        "no_prior": 1.0 if f.no_prior else 0.0,
        "vacated": f.vacated.of(kind),
        "pace": fallback.pace if f.pace is None else f.pace,
        "pass_rate": fallback.pass_rate if f.pass_rate is None else f.pass_rate,
        "allowance": f.allowance.of(kind),
        "home": f.home,
    }
    return tuple(values[c] for c in columns_for(kind))


@dataclass(frozen=True, slots=True)
class UsageLine:
    kind: Kind
    columns: tuple[str, ...]
    coefficients: tuple[float, ...]
    rows: int
    rank: int

    def predict(self, row: Sequence[float]) -> float:
        return float(np.dot(self.coefficients, row))


def fit_line(
    rows: Sequence[Sequence[float]], targets: Sequence[float], columns: tuple[str, ...], kind: Kind = "targets"
) -> UsageLine:
    """Ordinary least squares, no penalty: the minimum of the summed squared residuals."""
    if len(rows) < len(columns):
        raise ValueError(f"{len(rows)} rows cannot fit the {len(columns)} coefficients of a {kind} line")
    x = np.asarray(rows, dtype=float)
    y = np.asarray(targets, dtype=float)
    solution, _, rank, _ = np.linalg.lstsq(x, y, rcond=None)
    return UsageLine(kind, columns, tuple(float(v) for v in solution), len(rows), int(rank))


def _key(position: str, kind: Kind) -> str:
    return f"{position}|{kind}"


@dataclass(frozen=True, slots=True)
class StageOne:
    """The 17 lines, keyed `position|kind`, and the club means a row without a pace takes."""

    lines: Mapping[str, UsageLine]
    fallback: ClubMeans

    def predict(self, position: str, kind: Kind, f: Features) -> float:
        return self.lines[_key(position, kind)].predict(design(f, kind, self.fallback))

    def expected(self, position: str, f: Features) -> Work:
        """E: stage 1's prediction of each kind; a non-quarterback's pass attempts are his mean."""
        kinds = KINDS_BY_POSITION[position]
        found = {kind: self.predict(position, kind, f) for kind in kinds}
        passes = found[PASS_ATTEMPTS] if PASS_ATTEMPTS in kinds else f.season_mean.pass_attempts
        return Work(found["targets"], found["carries"], passes, found["snap_share"], found["red_zone"])


def fit_stage_one(rows: Sequence[tuple[str, Features, Work]], fallback: ClubMeans) -> StageOne:
    """Every position's lines from its fit rows: (position, inputs, the game's actual work)."""
    lines: dict[str, UsageLine] = {}
    for position, kinds in KINDS_BY_POSITION.items():
        kept = [(f, actual) for p, f, actual in rows if p == position]
        for kind in kinds:
            design_rows = [design(f, kind, fallback) for f, _ in kept]
            lines[_key(position, kind)] = fit_line(design_rows, [a.of(kind) for _, a in kept], columns_for(kind), kind)
    return StageOne(MappingProxyType(lines), fallback)


@dataclass(frozen=True, slots=True)
class RedZone:
    intercept: float
    slope: float  # delta_p,f


def opportunity_points(line: OpportunityLine, red_zone: RedZone, work: Work) -> float:
    """O_f(E): the opportunity line at the work, plus delta times its red-zone opportunities."""
    return line.points(work.targets, work.carries, work.pass_attempts, work.snap_share) + red_zone.slope * work.red_zone


def fit_red_zone(rows: Sequence[tuple[float, Work]], line: OpportunityLine) -> RedZone:
    """delta: the slope, with its intercept, of (points minus L at actual usage) on actual red-zone
    opportunities, over (actual points, actual work) rows of one position and format."""
    x = np.asarray([w.red_zone for _, w in rows], dtype=float)
    y = np.asarray([p - line.points(w.targets, w.carries, w.pass_attempts, w.snap_share) for p, w in rows], dtype=float)
    if len(rows) < 2 or float(np.var(x)) == 0.0:  # noqa: PLR2004 - a line needs two distinct points
        raise ValueError("the red-zone slope needs rows with differing red-zone opportunities")
    design_rows = np.column_stack([np.ones_like(x), x])
    (intercept, slope), *_ = np.linalg.lstsq(design_rows, y, rcond=None)
    return RedZone(float(intercept), float(slope))


def game_number(  # noqa: PLR0913, PLR0917 - the number's every input, named
    rate: float, f: Features, position: str, stage: StageOne, line: OpportunityLine, red_zone: RedZone
) -> float:
    """x = max(0, m + O(E_g) - O(E_n))."""
    game = opportunity_points(line, red_zone, stage.expected(position, f))
    base = opportunity_points(line, red_zone, stage.expected(position, neutral(f)))
    return max(0.0, rate + game - base)
