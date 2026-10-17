"""The served fit (section 4): the judged fit's cells read from its record and used with no selection,
the refit's windows, and a payload refused unless its bytes match the digest it pins."""

from dataclasses import asdict
from typing import Any, cast

import pytest

from research.model.weekly4.board import RoundShared, SeasonModels
from research.model.weekly4.served import (
    SERVED,
    SERVES,
    Served,
    ServedDigestError,
    deserialise,
    judged_cells,
    payload_of,
)
from research.model.weekly4.simulate import Dispersion
from research.model.weekly4.system import FixedCells
from research.model.weekly4.tuning import Cell


def test_the_refit_windows_are_section_fours() -> None:
    assert SERVED.player_fit_seasons == (2021, 2022, 2023, 2024)
    assert SERVED.team_fit_seasons == tuple(range(2016, 2025))
    assert SERVES == 2025  # noqa: PLR2004 - the season after the last fitted one


def test_the_judged_cells_are_read_from_the_record() -> None:
    cell = Cell(15, 1.0, 400, 50)
    share = Cell(7, 0.0, 200, 200, 0.85)
    record: dict[str, Any] = {
        "fitted": {
            "play_model_cells": {"target|catch": {"2023": asdict(Cell(7, 0.0, 200, 50)), "2024": asdict(cell)}},
            "team_model_cells": {"plays": {"2024": asdict(cell)}},
            "share_cells": {"2021-2022": asdict(Cell(7, 0.0, 200, 50, 0.5)), "2021-2022-2023": asdict(share)},
        }
    }
    found = judged_cells(record)
    assert found.play == {"target|catch": cell}
    assert found.team == {"plays": cell}
    assert found.shares == share


def _served() -> Served:
    dispersion = Dispersion(12.0, -0.005, 40.0, 6.0, {}, {"target": 9.0}, {"WR": 1.0})
    return Served(cast("SeasonModels", "models"), cast("RoundShared", "shared"), dispersion)


def test_a_payload_is_read_back_only_against_its_digest() -> None:
    cells = FixedCells({}, {}, Cell(7, 0.0, 200, 50, 1.0))
    payload = payload_of(_served(), cells, "judged")
    assert deserialise(payload).dispersion.margin_sd == 12.0  # noqa: PLR2004 - the dispersion written
    with pytest.raises(ServedDigestError, match="digest"):
        deserialise({**payload, "digest": "0" * 64})
    with pytest.raises(ServedDigestError, match="scikit-learn"):
        deserialise({**payload, "sklearn": "0.0"})
