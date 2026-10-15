"""Weekly round 3's instant and schedule knowledge (preregistration section 3 and section 2, "The
pairing is a box-score table read for its four pairing columns only")."""

import re
from datetime import UTC, datetime, timedelta
from types import MappingProxyType

from research.model.weekly3.instant import PAIRING_COLUMNS, PAIRING_QUERY, Schedule, game_instant

_THU = datetime(2023, 10, 20, 0, 15, tzinfo=UTC)
_SUN = datetime(2023, 10, 22, 17, 0, tzinfo=UTC)
_MON = datetime(2023, 10, 24, 0, 15, tzinfo=UTC)


def _schedule() -> Schedule:
    kickoffs = {(7, "JAX"): _THU, (7, "NO"): _THU, (7, "KC"): _SUN, (7, "LAC"): _SUN, (7, "SF"): _MON}
    pairing = {
        (5, "KC"): "MIN",
        (6, "KC"): "DEN",
        (7, "KC"): "LAC",
        (7, "LAC"): "KC",
        (7, "JAX"): "NO",
        (7, "NO"): "JAX",
        (4, "KC"): "NYJ",
        (2, "KC"): "JAX",
    }
    home = {(7, "KC"): 1.0, (7, "LAC"): 0.0}
    return Schedule(2023, MappingProxyType(kickoffs), MappingProxyType(home), MappingProxyType(pairing))


def test_the_instant_is_one_millisecond_before_the_games_own_kickoff() -> None:
    assert game_instant(_SUN) == _SUN - timedelta(milliseconds=1)
    assert _schedule().instant(7, "KC") == _SUN - timedelta(milliseconds=1)


def test_a_club_with_no_kickoff_that_week_has_no_instant() -> None:
    assert _schedule().instant(7, "BUF") is None


def test_the_weeks_instants_are_each_kickoff_slot_once_in_order() -> None:
    found = _schedule().moments(7)
    assert found == tuple(k - timedelta(milliseconds=1) for k in (_THU, _SUN, _MON))
    assert _schedule().first_moment(7) == _THU - timedelta(milliseconds=1)


def test_the_opponent_home_field_and_the_clubs_games_before_a_week() -> None:
    schedule = _schedule()
    assert schedule.opponent(7, "KC") == "LAC"
    assert schedule.home(7, "KC") == 1.0
    assert schedule.home(7, "LAC") == 0.0
    assert schedule.club_weeks("KC", 7) == (2, 4, 5, 6)


def test_the_pairing_query_selects_exactly_its_four_columns() -> None:
    assert PAIRING_COLUMNS == ("season", "week", "team", "opponent_team")
    selected = re.search(r"select\s+(.*?)\s+from", PAIRING_QUERY, re.IGNORECASE | re.DOTALL)
    assert selected is not None
    assert tuple(c.strip() for c in selected.group(1).split(",")) == PAIRING_COLUMNS
    assert "research.nflverse_team_defense_weeks" in PAIRING_QUERY
    assert "*" not in PAIRING_QUERY
