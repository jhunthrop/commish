"""DIFFING BOARDS AND REGISTERS: column by column, every difference counted and the worst named."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

POINT_COLUMNS: Final = ("projectedPoints", "floorPoints", "medianPoints", "ceilingPoints", "expectedGames")


@dataclass(frozen=True, slots=True)
class Diff:
    """One comparison: rows on each side, differing cells, the largest numeric gap, and examples."""

    what: str
    left_rows: int
    right_rows: int
    only_left: tuple[str, ...]
    only_right: tuple[str, ...]
    differing: int
    worst: float
    examples: tuple[str, ...] = field(default=())
    may_be_empty: bool = False

    @property
    def matches(self) -> bool:
        compared = self.left_rows > 0 or self.may_be_empty
        return compared and self.differing == 0 and not self.only_left and not self.only_right


def _number(value: Any) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def diff_rows(
    what: str,
    left: Mapping[str, Mapping[str, Any]],
    right: Mapping[str, Mapping[str, Any]],
    tolerance: float = 0.0,
    may_be_empty: bool = False,
) -> Diff:
    """Keyed rows compared cell by cell: a number within `tolerance`, anything else equal."""
    differing = 0
    worst = 0.0
    examples: list[str] = []
    for key in sorted(set(left) & set(right)):
        for column, value in left[key].items():
            other = right[key].get(column)
            a, b = _number(value), _number(other)
            if a is not None and b is not None:
                gap = abs(a - b)
                worst = max(worst, gap)
                same = gap <= tolerance
            else:
                same = value == other
            if not same:
                differing += 1
                if len(examples) < 3:  # noqa: PLR2004 - enough examples to name a difference
                    examples.append(f"{key} {column}: {value!r} against {other!r}")
    return Diff(
        what,
        len(left),
        len(right),
        tuple(sorted(set(left) - set(right))),
        tuple(sorted(set(right) - set(left))),
        differing,
        worst,
        tuple(examples),
        may_be_empty,
    )


def keyed(rows: Sequence[Mapping[str, Any]], key: str = "playerId") -> dict[str, Mapping[str, Any]]:
    return {str(row[key]): row for row in rows}


def leg_diffs(oracle: Sequence[Mapping[str, Any]], port: Sequence[Mapping[str, Any]], label: str) -> list[Diff]:
    """Each leg the oracle built against the port's: the rows (every column, reasons included) and
    the roster gate's exclusions."""
    by_leg = {line["leg"]: line for line in port}
    diffs: list[Diff] = []
    for line in oracle:
        mine = by_leg.get(line["leg"], {"rows": [], "excluded": []})
        diffs.append(diff_rows(f"{label} {line['leg']} board", keyed(line["rows"]), keyed(mine["rows"])))
        diffs.append(
            diff_rows(
                f"{label} {line['leg']} exclusions", keyed(line["excluded"]), keyed(mine["excluded"]), may_be_empty=True
            )
        )
    return diffs
