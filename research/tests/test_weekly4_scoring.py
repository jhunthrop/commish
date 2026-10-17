# ruff: noqa: PLR2004 - hand-made cases
"""Round 4's sources scored on the same population rows (3.1): every source with no number for a row
ranks it below every row it has, ties averaged; ADP ranks low first; the deltas and places off are
round 2's."""

import pytest

from research.model.weekly4.gates import ROUND_FOUR
from research.model.weekly4.scoring import Row, orderings, source_names


def _row(week: int, pid: str, actual: float, model: float | None, adp: float | None) -> Row:
    points = {"ppr": actual, "half": actual, "std": actual}

    def p(v: float | None) -> dict[str, float] | None:
        return None if v is None else {"ppr": v, "half": v, "std": v}

    return Row(week, pid, "WR", points, {"model": p(model), "form": p(actual), "last_three": None}, adp)


def test_the_sources_are_ordered_by_points_and_adp_by_rank() -> None:
    rows = [_row(6, f"p{i}", float(i), float(i), float(10 - i)) for i in range(10)]
    found = orderings(rows, [6], "ppr", ROUND_FOUR.statistics, ("model", "form", "last_three"))
    wr = next(o for o in found if o.position == "WR")
    assert wr.rho["model"] == pytest.approx(1.0)
    assert wr.rho["adp"] == pytest.approx(1.0)
    assert "last_three" in wr.rho  # a source with no number for any row still answers
    assert set(source_names(("model", "form"))) == {"model", "form", "adp"}


def test_a_row_without_a_number_ranks_below_every_row_with_one() -> None:
    rows = [_row(6, f"p{i}", float(i), None if i == 9 else float(i), None) for i in range(10)]
    found = orderings(rows, [6], "ppr", ROUND_FOUR.statistics, ("model",))
    wr = next(o for o in found if o.position == "WR")
    assert wr.rho["model"] is not None and wr.rho["model"] < 1.0
    assert wr.size == 10
