"""The game's figures from the hourly odds capture (Lane 66a, the round 4 preregistration section 2.5):
each `tank01_betting_odds` snapshot parsed into the consensus spread and total per game, the club's
implied points derived once, written as the `tank01_lines` team-week source."""

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from research.errors import SchemaDriftError
from research.pipeline.game_figures import implied_points
from research.pipeline.tank01.lines import (
    LINES_SOURCE,
    GamePlace,
    LinesMetric,
    line_observations,
    parse_snapshot,
    parse_spread,
)

_DATA = Path(__file__).resolve().parent / "testdata" / "tank01-lines"
_AT = datetime(2026, 10, 12, 23, 59, 11, tzinfo=UTC)
NEWEST = "odds-2026-10-12T23.json"
WEEK_ONE_SUNDAY = "odds-2026-09-13T00.json"


def _recorded(name: str) -> object:
    return json.loads((_DATA / name).read_text(encoding="utf-8"))


def test_implied_points_split_the_total_by_the_spread() -> None:
    figures = [implied_points(47.5, 3.0), implied_points(47.5, -3.0), implied_points(44.0, 0.0)]
    assert figures == [25.25, 22.25, 22.0]


def test_a_spread_reads_signed_numbers_and_a_level_game_and_refuses_anything_else() -> None:
    assert [parse_spread(raw) for raw in ("-3.5", "+7", "3", "PK")] == [-3.5, 7.0, 3.0, 0.0]
    for garbage in ("--7.5", "+-2.5", "", "even", "3.5.1", None, 3.5):
        assert parse_spread(garbage) is None


def test_the_newest_snapshot_is_one_game_with_the_median_of_its_books_in_the_store_sign() -> None:
    (line,) = parse_snapshot(_recorded(NEWEST))
    assert (line.game_id, line.home, line.away) == ("20261012_BUF@LAR", "LAR", "BUF")
    # Every book has the home club at -3.5: the Rams favoured by 3.5, positive in the store's sign.
    # Totals 55.5 four times and 55 four times: the median of eight is the mean of the middle two.
    assert (line.home_spread, line.total, line.books, line.rejected) == (3.5, 55.25, 8, ())


def test_a_book_quoting_a_doubled_sign_is_left_out_by_name_and_the_rest_carry_the_game() -> None:
    lines = {line.game_id: line for line in parse_snapshot(_recorded(WEEK_ONE_SUNDAY))}
    jax = lines["20260913_CLE@JAX"]
    assert (len(lines), jax.rejected, jax.books) == (13, ("hardrock",), 7)
    assert all(line.books >= 1 for line in lines.values())


def test_a_multi_date_capture_is_a_list_of_bodies_and_reads_as_one_set_of_games() -> None:
    newest, sunday = _recorded(NEWEST), _recorded(WEEK_ONE_SUNDAY)
    together = parse_snapshot([newest, sunday])
    assert together == [*parse_snapshot(newest), *parse_snapshot(sunday)]
    assert parse_snapshot([]) == []
    assert parse_snapshot({}) == []


def test_an_unknown_shape_is_refused_rather_than_read_as_no_games() -> None:
    for payload in ("no games", [1], {"20261012_BUF@LAR": "x"}, {"20261012_BUF@LAR": {"gameID": "other"}}):
        with pytest.raises(SchemaDriftError):
            parse_snapshot(payload)


def test_each_club_gets_its_own_side_of_the_figures_in_nflverse_spelling() -> None:
    (line,) = parse_snapshot(_recorded(NEWEST))
    rows, unplaced = line_observations([line], {line.game_id: GamePlace(2026, 6, "LAR", "BUF")}, _AT)
    assert unplaced == []
    assert {(row.source, row.season, row.week, row.as_of) for row in rows} == {(LINES_SOURCE, 2026, 6, _AT)}
    assert {(row.team, row.metric): row.value for row in rows} == {
        ("LA", LinesMetric.POINT_SPREAD): 3.5,
        ("BUF", LinesMetric.POINT_SPREAD): -3.5,
        ("LA", LinesMetric.GAME_TOTAL): 55.25,
        ("BUF", LinesMetric.GAME_TOTAL): 55.25,
        ("LA", LinesMetric.IMPLIED_TEAM_TOTAL): implied_points(55.25, 3.5),
        ("BUF", LinesMetric.IMPLIED_TEAM_TOTAL): implied_points(55.25, -3.5),
        ("LA", LinesMetric.BOOKS): 8.0,
        ("BUF", LinesMetric.BOOKS): 8.0,
    }


def test_a_game_the_schedule_does_not_place_or_places_with_other_clubs_writes_nothing() -> None:
    (line,) = parse_snapshot(_recorded(NEWEST))
    rows, unplaced = line_observations([line], {}, _AT)
    assert rows == [] and unplaced == ["20261012_BUF@LAR (not in the provider schedule)"]
    rows, unplaced = line_observations([line], {line.game_id: GamePlace(2026, 6, "BUF", "LAR")}, _AT)
    assert rows == [] and unplaced == ["20261012_BUF@LAR (the schedule has BUF at home to LAR)"]
