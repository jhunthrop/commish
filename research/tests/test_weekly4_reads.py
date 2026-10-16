"""The feature store's reads select exactly their kinds' admitted pairs (round 4 preregistration,
section 5 item 5: "a guard test asserts the selected metric list"), and the per-instant view of a
season's rows is the as-of read's predicate."""

import re
from datetime import UTC, datetime, timedelta

from research.model.weekly3.ledger import ReadKind
from research.model.weekly4.features import reads
from research.model.weekly4.features.admitted import ADMITTED, DEPTH_CHARTS, GAME_WEATHER, PLAYS, STADIUMS
from research.pipeline.nflverse.team_eras import season_code
from research.pipeline.observations import PlayerWeekObservation

_SELECT = re.compile(r"^select (.+?) from research\.(\w+)")


def _selected(query: str) -> set[tuple[str, str]]:
    found = _SELECT.match(query)
    assert found is not None
    return {(found[2], column.strip()) for column in found[1].split(",")}


def test_each_table_read_selects_its_kinds_pairs_and_nothing_else() -> None:
    assert _selected(reads.PLAYS_QUERY) == {p for p in ADMITTED["plays"] if p[0] == PLAYS}
    assert _selected(reads.WEATHER_QUERY) == ADMITTED["weather"]
    assert _selected(reads.DEPTH_QUERY) == ADMITTED["depth"] == ADMITTED["depth_prior"]
    assert _selected(reads.STADIUM_QUERY) == {p for p in ADMITTED["schedule"] if p[0] == STADIUMS}
    assert {t for t, _ in _selected(reads.WEATHER_QUERY)} == {GAME_WEATHER}
    pairing = {p for p in ADMITTED["schedule"] if p[0] == GAME_WEATHER}
    assert _selected(reads.GAME_PAIRING_QUERY) == pairing
    assert {c for _, c in pairing} == {"season", "week", "home_team", "away_team"}
    assert {t for t, _ in _selected(reads.DEPTH_QUERY)} == {DEPTH_CHARTS}


def test_each_observation_read_selects_its_kinds_metric_list() -> None:
    assert {(s, m) for s, metrics in reads.CHARTED_SOURCES for m in metrics} == ADMITTED["charted"]

    def selected(kind: ReadKind) -> set[tuple[str, str]]:
        sources, metrics = reads.TEAM_READS[kind]
        return {(s, m) for s in sources for m in metrics}

    for kind in ("figures", "live_figures", "forecast"):
        assert selected(kind) == ADMITTED[kind]
    assert selected("schedule") == {p for p in ADMITTED["schedule"] if p[0] == "nflverse_schedule"}
    assert selected("box") == {p for p in ADMITTED["box"] if p[0] == "nflverse_pbp"}
    assert selected("figures") == {("nflverse_kickoff", "implied_team_total"), ("nflverse_kickoff", "point_spread")}


def test_play_by_play_codes_are_spelled_as_their_season_spelled_them() -> None:
    assert [season_code(2016, c) for c in ("LV", "LAC", "LA", "KC")] == ["OAK", "SD", "LA", "KC"]
    assert [season_code(2019, c) for c in ("LV", "LAC")] == ["OAK", "LAC"]
    assert [season_code(2020, c) for c in ("LV", "OAK")] == ["LV", "OAK"]


def test_the_instant_view_is_the_as_of_predicate() -> None:
    t = datetime(2023, 10, 22, 17, tzinfo=UTC)

    def row(week: int, as_of: datetime) -> PlayerWeekObservation:
        return PlayerWeekObservation(2023, week, "p", "nflverse_ngs", "rec_targets", 1.0, as_of)

    rows = [row(5, t - timedelta(days=9)), row(6, t - timedelta(days=2)), row(6, t + timedelta(hours=1)), row(7, t)]
    assert reads.as_of_rows(rows, 1, 6, t) == rows[:2]
