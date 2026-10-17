# ruff: noqa: PLR2004 - hand-made cases
"""Round 4's preconditions (6.3), each missing one named: the round 4 inputs per season, the game
figures per club-week, a stadium row for every stadium, the depth chart check's recorded verdict
matching the store's build, and round 3's own preconditions."""

from research.model.weekly4.gates import DEVELOPMENT_CHECK
from research.model.weekly4.preconditions import (
    EXPECTED_FIGURES,
    RESULTS,
    Counts,
    depth_chart_verdict,
    missing_preconditions,
)


def _complete() -> Counts:
    seasons = range(2016, 2024)
    return Counts(
        plays=dict.fromkeys(seasons, 40000),
        charts=dict.fromkeys(seasons, 9000),
        ngs=dict.fromkeys(seasons, 20000),
        pfr=dict.fromkeys(range(2018, 2024), 30000),
        roofs={s: (EXPECTED_FIGURES[s] // 2, EXPECTED_FIGURES[s] // 2) for s in seasons},
        figures={s: EXPECTED_FIGURES[s] for s in seasons},
        stadiums_missing=0,
        weather={s: {"outdoor": 380, "missing": 2} for s in seasons},
        round_three=[],
    )


def test_a_complete_store_has_no_missing_precondition() -> None:
    assert missing_preconditions(_complete(), DEVELOPMENT_CHECK, "week", "week") == []


def test_each_gap_is_named() -> None:
    counts = _complete()
    gaps = Counts(
        plays={**counts.plays, 2019: 0},
        charts=counts.charts,
        ngs=counts.ngs,
        pfr={k: v for k, v in counts.pfr.items() if k != 2020},
        roofs={**counts.roofs, 2022: (270, 271)},
        figures={**counts.figures, 2021: 543},
        stadiums_missing=2,
        weather=counts.weather,
        round_three=["stamped injury filings for 2023 week 6"],
    )
    missing = missing_preconditions(gaps, DEVELOPMENT_CHECK, "week", "prior")
    joined = "; ".join(missing)
    for fragment in (
        "play table rows for 2019",
        "PFR",
        "2020",
        "roof state for 1 of 271",
        "544 game figures",
        "2 stadium",
        "round 3",
        "verdict",
    ):
        assert fragment in joined


def test_the_recorded_verdict_is_read_from_the_results() -> None:
    found = depth_chart_verdict(RESULTS)
    assert found == "week"
