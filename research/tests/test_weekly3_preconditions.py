"""Weekly round 3's preconditions (preregistration section 6): each refusal names what is missing,
the pairing one to one with the kickoff club-weeks and symmetric, and the development check asks
nothing of 2024."""

from datetime import UTC, datetime
from types import MappingProxyType

from research.model.weekly3.gates import DEVELOPMENT_CHECK, ROUND_THREE
from research.model.weekly3.instant import Schedule
from research.model.weekly3.preconditions import (
    CLUB_EDGES,
    PLAYER_INPUTS,
    TEAM_INPUTS,
    StoreCounts,
    input_seasons,
    missing_preconditions,
)

_K = datetime(2023, 10, 22, tzinfo=UTC)
_WEEKS = range(6, 18)


def _schedule(season: int) -> Schedule:
    pairing = {(w, "A"): "B" for w in _WEEKS} | {(w, "B"): "A" for w in _WEEKS}
    return Schedule(
        season,
        MappingProxyType(dict.fromkeys(pairing, _K)),
        MappingProxyType(dict.fromkeys(pairing, 1.0)),
        MappingProxyType(pairing),
    )


def _full(seasons: tuple[int, ...], judged: tuple[int, ...]) -> StoreCounts:
    inputs = {(i, s): 10 for s in seasons for i in (*PLAYER_INPUTS, *TEAM_INPUTS, CLUB_EDGES)}
    return StoreCounts(
        inputs,
        {(s, w): 5 for s in judged for w in _WEEKS},
        {2023: 188, 2024: 189},
        {s: _schedule(s) for s in judged},
    )


def test_a_full_store_passes() -> None:
    assert missing_preconditions(_full(input_seasons(ROUND_THREE), (2021, 2022, 2023, 2024)), ROUND_THREE) == []


def test_the_inputs_run_from_the_prior_season_to_the_judgment_season() -> None:
    assert input_seasons(ROUND_THREE) == (2020, 2021, 2022, 2023, 2024)
    assert input_seasons(DEVELOPMENT_CHECK) == (2020, 2021, 2022, 2023)


def test_the_development_check_needs_nothing_of_2024() -> None:
    counts = _full(input_seasons(DEVELOPMENT_CHECK), (2021, 2022, 2023))
    assert missing_preconditions(counts, DEVELOPMENT_CHECK) == []


def test_a_missing_input_is_named() -> None:
    counts = _full(input_seasons(ROUND_THREE), (2021, 2022, 2023, 2024))
    inputs = dict(counts.inputs)
    del inputs[(("nflverse_pbp_player", "red_zone_targets"), 2020)]
    found = missing_preconditions(StoreCounts(inputs, counts.filings, counts.adp, counts.schedules), ROUND_THREE)
    assert found == ["nflverse_pbp_player red_zone_targets rows for 2020"]


def test_a_kickoff_club_week_with_no_pairing_and_an_asymmetric_pairing_are_named() -> None:
    schedule = _schedule(2023)
    kickoffs = {**schedule.kickoffs, (9, "C"): _K}
    pairing = {**schedule.pairing, (10, "A"): "C"}
    broken = Schedule(2023, MappingProxyType(kickoffs), schedule.home_field, MappingProxyType(pairing))
    counts = _full(input_seasons(DEVELOPMENT_CHECK), (2021, 2022, 2023))
    found = missing_preconditions(
        StoreCounts(counts.inputs, counts.filings, counts.adp, {**counts.schedules, 2023: broken}), DEVELOPMENT_CHECK
    )
    assert "a pairing row for 2023 week 9 C, which has a kickoff" in found
    assert "a home_field row for 2023 week 9 C" in found
    assert any("symmetric pairing for 2023 week 10: A faces C" in line for line in found)


def test_a_paired_club_week_with_no_kickoff_is_named() -> None:
    schedule = _schedule(2022)
    kickoffs = {k: v for k, v in schedule.kickoffs.items() if k != (7, "A")}
    broken = Schedule(2022, MappingProxyType(kickoffs), schedule.home_field, schedule.pairing)
    counts = _full(input_seasons(DEVELOPMENT_CHECK), (2021, 2022, 2023))
    found = missing_preconditions(
        StoreCounts(counts.inputs, counts.filings, counts.adp, {**counts.schedules, 2022: broken}), DEVELOPMENT_CHECK
    )
    assert found == ["a kickoff_instant row for 2022 week 7 A, which the pairing says played"]


def test_missing_filings_and_adp_are_named() -> None:
    counts = _full(input_seasons(ROUND_THREE), (2021, 2022, 2023, 2024))
    filings = {k: v for k, v in counts.filings.items() if k != (2024, 9)}
    found = missing_preconditions(StoreCounts(counts.inputs, filings, {2023: 188}, counts.schedules), ROUND_THREE)
    assert found == ["stamped injury filings (injury_report_status) for 2024 week 9", "ADP (ffc_adp_ppr_12) for 2024"]
