# ruff: noqa: PLR2004 - the expected values are hand-computed from the games written beside them
"""Round 4's matchup and tempo (preregistration sections 2.4 and 2.5): the role allowances on round
3's construction, the defence's pressure from the plays and PFR, and the clubs' shrunk tempo."""

import math
from datetime import UTC, datetime
from types import MappingProxyType

import pytest

from research.model.weekly3.instant import Schedule
from research.model.weekly4.features.matchup import (
    NO_PACE,
    NO_PFR_PRESSURE,
    RB_AIR_SHARE,
    club_tempo,
    defence_pressure,
    pass_rate_allowed,
    role_allowances,
)
from research.model.weekly4.features.plays import Counts, GroupTargets, PlayerTally, Pressure, Tallies

_AT = datetime(2023, 9, 10, tzinfo=UTC)


def _schedule() -> Schedule:
    # Week 1: DEN v KC, LV v LAC. Week 2: DEN v LV, KC v LAC. Week 3: DEN v LAC (the game ahead).
    pairs = {1: (("DEN", "KC"), ("LV", "LAC")), 2: (("DEN", "LV"), ("KC", "LAC")), 3: (("DEN", "LAC"), ("KC", "LV"))}
    pairing: dict[tuple[int, str], str] = {}
    for week, games in pairs.items():
        for a, b in games:
            pairing[(week, a)], pairing[(week, b)] = b, a
    kickoffs = dict.fromkeys(pairing, _AT)
    return Schedule(
        2023, MappingProxyType(kickoffs), MappingProxyType(dict.fromkeys(pairing, 1.0)), MappingProxyType(pairing)
    )


def _tallies() -> Tallies:
    groups = {
        ("KC", 1): {"RB": GroupTargets(air=6.0, ground=14.0)},  # 0.3 against DEN
        ("KC", 2): {"RB": GroupTargets(air=2.0, ground=18.0)},  # 0.1 elsewhere
        ("LV", 2): {"RB": GroupTargets(air=4.0, ground=16.0)},  # 0.2 against DEN
        ("LV", 1): {"RB": GroupTargets(air=4.0, ground=16.0)},  # 0.2 elsewhere
    }
    clubs = dict.fromkeys(groups, Counts(targets=30.0))
    players = {
        ("qb_kc", 1): PlayerTally("KC", Counts(dropbacks=40.0)),
        ("qb_lv", 2): PlayerTally("LV", Counts(dropbacks=35.0)),
    }
    defences = {("DEN", 1): Pressure(40.0, 3.0, 8.0), ("DEN", 2): Pressure(35.0, 2.0, 6.0)}
    return Tallies(
        MappingProxyType(players),
        MappingProxyType(clubs),
        MappingProxyType(defences),
        MappingProxyType({k: MappingProxyType(v) for k, v in groups.items()}),
    )


def test_the_running_backs_air_share_allowance_is_round_threes_construction() -> None:
    found = role_allowances("DEN", 3, "RB", _schedule(), _tallies())
    ratio = ((0.3 + 0.2) / 2) / ((0.1 + 0.2) / 2)
    assert found[RB_AIR_SHARE].games == 2
    assert found[RB_AIR_SHARE].value == pytest.approx((2 * ratio + 6) / (2 + 6))
    assert role_allowances("DEN", 3, "QB", _schedule(), _tallies()) == {}


def test_the_receivers_allowances_are_shares_of_the_groups_targets() -> None:
    schedule = _schedule()
    groups = {
        ("KC", 1): {"WR": GroupTargets(air=20.0, depth=(2.0, 8.0, 6.0, 4.0), outside=15.0, middle=5.0)},  # v DEN
        ("KC", 2): {"WR": GroupTargets(air=10.0, depth=(1.0, 5.0, 3.0, 1.0), outside=5.0, middle=5.0)},
    }
    tallies = Tallies(
        MappingProxyType({}),
        MappingProxyType(dict.fromkeys(groups, Counts(targets=20.0))),
        MappingProxyType({}),
        MappingProxyType({k: MappingProxyType(v) for k, v in groups.items()}),
    )
    found = role_allowances("DEN", 3, "WR", schedule, tallies)
    deep = (0.2 / 0.1 + 6) / 7  # one game: 4 of 20 deep against DEN, 1 of 10 elsewhere
    assert found["depth_deep"].value == pytest.approx(deep)
    assert found["outside"].value == pytest.approx((0.75 / 0.5 + 6) / 7)
    assert RB_AIR_SHARE not in found


def test_the_pass_rate_allowed_is_a_difference_shrunk_toward_zero() -> None:
    rows = {
        ("KC", 1): {"pass_rate_over_expected": 8.0},  # against DEN
        ("KC", 2): {"pass_rate_over_expected": 2.0},
        ("LV", 2): {"pass_rate_over_expected": -1.0},  # against DEN
        ("LV", 1): {"pass_rate_over_expected": -5.0},
    }
    found = pass_rate_allowed("DEN", 3, _schedule(), rows)
    gap = ((8.0 - 2.0) + (-1.0 - -5.0)) / 2
    assert found.games == 2 and found.value == pytest.approx(2 * gap / 8)
    first = pass_rate_allowed("DEN", 1, _schedule(), rows)
    assert (first.value, first.default) == (0.0, "allowance_without_a_game")


def test_pressure_is_per_dropback_faced_and_pfr_reads_the_passers_faced() -> None:
    found = defence_pressure("DEN", 3, _schedule(), _tallies(), {1: {"qb_kc": 12.0}, 2: {"qb_lv": 9.0}})
    assert found.sack_rate == pytest.approx(5.0 / 75.0)
    assert found.hit_rate == pytest.approx(14.0 / 75.0)
    assert found.pfr_rate == pytest.approx(21.0 / 75.0)
    assert NO_PFR_PRESSURE in defence_pressure("DEN", 3, _schedule(), _tallies(), {}).defaults


def test_tempo_shrinks_the_pass_rate_toward_zero_and_the_pace_toward_the_league() -> None:
    rows = {
        ("KC", 1): {"pace_seconds_per_play": 28.0, "pass_rate_over_expected": 6.0},
        ("KC", 2): {"pace_seconds_per_play": 26.0, "pass_rate_over_expected": 2.0},
    }
    found = club_tempo("KC", 3, _schedule(), rows, 30.0)
    assert found.pass_rate_over_expected == pytest.approx(2 * 4.0 / 8)
    assert found.pace == pytest.approx((2 * 27.0 + 6 * 30.0) / 8)
    first = club_tempo("KC", 1, _schedule(), rows, 30.0)
    assert math.isnan(first.pace) and NO_PACE in first.defaults
