"""The realised margin is the club's points less the opponent's, and the reader refuses a season it
does not serve before any read."""

from typing import cast

import pandas as pd
import pytest
from sqlalchemy import Connection

from research.model.weekly4.margins import MarginReader, MarginSeasonError, margins


def test_the_margin_is_the_opponents_points_allowed_less_the_clubs() -> None:
    allowed = pd.DataFrame({"season": [2022, 2022], "week": [1, 1], "club": ["A", "B"], "points_allowed": [17.0, 24.0]})
    pairing = pd.DataFrame({"season": [2022, 2022], "week": [1, 1], "club": ["A", "B"], "opponent": ["B", "A"]})
    found = margins(allowed, pairing).set_index("club")["margin"].to_dict()
    assert found == {"A": 7.0, "B": -7.0}


def test_the_reader_refuses_a_season_it_does_not_serve() -> None:
    with pytest.raises(MarginSeasonError):
        MarginReader(frozenset({2022})).season(cast("Connection", None), 2023)  # refused before any read
