"""The weekly depth charts against recorded rows (`testdata/nflverse/depth_charts_2016.csv`: ATL and TB,
weeks 1 and 2, every formation; `depth_charts_2026.csv`: SEA and NE, four dated snapshots around
week 1), with the clubs' stored kickoffs as the schedule ingest wrote them."""

import os
from collections import Counter
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import Engine

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.errors import SchemaDriftError
from research.parity import databases
from research.pipeline.kickoffs import TeamKickoff
from research.pipeline.nflverse import depth_chart_weeks as charts
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.tests.nflverse_fixtures import FixtureFetcher, fixture_rows

_DATABASE = "parity_test_depth_chart_weeks"
_SKILL = ("QB", "RB", "FB", "WR", "TE")


def _at(year: int, month: int, day: int, hour: int = 0, minute: int = 0, second: int = 0) -> datetime:  # noqa: PLR0913, PLR0917 - datetime's own fields
    return datetime(year, month, day, hour, minute, second, tzinfo=UTC)


KICKOFFS_2016 = [
    TeamKickoff(2016, 1, "ATL", _at(2016, 9, 11, 17)),
    TeamKickoff(2016, 1, "TB", _at(2016, 9, 11, 17)),
    TeamKickoff(2016, 2, "TB", _at(2016, 9, 18, 17)),
    TeamKickoff(2016, 2, "ATL", _at(2016, 9, 18, 20, 25)),
    # The week's first and last games elsewhere: Thursday and Monday nights.
    TeamKickoff(2016, 1, "DEN", _at(2016, 9, 9, 0, 30)),
    TeamKickoff(2016, 1, "SF", _at(2016, 9, 13, 2, 20)),
    TeamKickoff(2016, 2, "BUF", _at(2016, 9, 16, 0, 25)),
]
KICKOFFS_2026 = [
    TeamKickoff(2026, 1, "NE", _at(2026, 9, 10, 0, 20)),
    TeamKickoff(2026, 1, "SEA", _at(2026, 9, 10, 0, 20)),
    TeamKickoff(2026, 2, "NE", _at(2026, 9, 20, 17)),
    TeamKickoff(2026, 2, "SEA", _at(2026, 9, 20, 20, 25)),
    TeamKickoff(2026, 3, "NE", _at(2026, 9, 27, 17)),
    TeamKickoff(2026, 3, "SEA", _at(2026, 9, 27, 17)),
]


def test_a_week_is_stamped_at_the_wednesday_pass_before_its_first_kickoff() -> None:
    stamps = charts.weekly_stamps(KICKOFFS_2016)
    # Wednesday 18:00 New York (EDT) is 22:00 UTC.
    assert stamps == {1: _at(2016, 9, 7, 22), 2: _at(2016, 9, 14, 22)}


def test_a_wednesday_game_takes_the_tuesday_pass() -> None:
    # Christmas 2024: week 16 ends Monday night, week 17 starts Wednesday 13:00 New York.
    week16_last, week17_first = _at(2024, 12, 24, 1, 15), _at(2024, 12, 25, 18)
    assert charts.latest_pass_before(week17_first, week16_last) == _at(2024, 12, 24, 13)


def test_a_pass_while_the_last_game_is_played_is_not_taken() -> None:
    # 2020 week 12 ended on Wednesday 2 December, PIT at BAL at 15:40 New York; week 13 began Sunday.
    week12_last, week13_first = _at(2020, 12, 2, 20, 40), _at(2020, 12, 6, 18)
    assert charts.latest_pass_before(week13_first, week12_last) == _at(2020, 12, 3, 19)  # Thursday 14:00


def test_no_pass_between_two_weeks_is_refused() -> None:
    with pytest.raises(SchemaDriftError, match="no in-season pass"):
        charts.latest_pass_before(_at(2024, 12, 25, 18), _at(2024, 12, 25, 12))


def _weekly() -> list[charts.ChartRow]:
    rows, read, _ = charts.chart_rows_for(NflverseClient(FixtureFetcher()), 2016, KICKOFFS_2016)
    assert read == len(fixture_rows("depth_charts_2016.csv"))
    return rows


def test_the_weekly_schema_keeps_the_offensive_skill_rows_of_the_regular_season() -> None:
    expected = [
        r for r in fixture_rows("depth_charts_2016.csv")
        if r["formation"] == "Offense" and r["game_type"] == "REG" and r["position"].strip() in _SKILL and r["gsis_id"]
    ]  # fmt: skip
    rows = _weekly()
    assert len(rows) == len(expected)
    assert Counter((r.week, r.team) for r in rows) == Counter((int(r["week"]), r["club_code"]) for r in expected)
    starter = next(r for r in expected if r["depth_position"] == "QB" and r["depth_team"] == "1")
    mine = next(r for r in rows if r.player_id == starter["gsis_id"] and r.week == int(starter["week"]))
    assert (mine.slot, mine.depth_order, mine.position) == ("QB", 1, "QB")
    assert {r.as_of for r in rows if r.week == 1} == {_at(2016, 9, 7, 22)}


def test_a_week_inside_the_season_the_schedule_does_not_hold_is_refused() -> None:
    with pytest.raises(NflverseError, match="week 1, which the stored schedule does not hold"):
        charts.chart_rows_for(NflverseClient(FixtureFetcher()), 2016, [k for k in KICKOFFS_2016 if k.week == 2])  # noqa: PLR2004 - week 2


def test_a_club_no_stored_kickoff_names_is_refused() -> None:
    kickoffs = [k for k in KICKOFFS_2016 if k.team != "TB"]
    with pytest.raises(NflverseError, match='club "TB"'):
        charts.chart_rows_for(NflverseClient(FixtureFetcher()), 2016, kickoffs)
    with pytest.raises(SchemaDriftError, match=r"clubs \['NE'\]"):
        charts.chart_rows_for(
            NflverseClient(FixtureFetcher()),
            2026,
            [k for k in KICKOFFS_2026 if k.team != "NE"] + [TeamKickoff(2026, 1, "TB", _at(2026, 9, 10, 0, 20))],
        )


def test_the_chart_after_the_final_week_is_passed_over() -> None:
    week1 = [k for k in KICKOFFS_2016 if k.week == 1]
    weekly = charts.WeeklyCharts(2016, charts.weekly_stamps(week1), frozenset(k.team for k in KICKOFFS_2016))
    for row in fixture_rows("depth_charts_2016.csv"):
        weekly.add(row)
    assert {r.week for r in weekly.rows} == {1}
    assert weekly.after_season > 0


def _dated() -> list[charts.ChartRow]:
    rows, _, _ = charts.chart_rows_for(NflverseClient(FixtureFetcher()), 2026, KICKOFFS_2026)
    return rows


def test_each_dated_club_game_takes_its_latest_snapshot_since_the_previous_kickoff() -> None:
    stamps = {(r.week, r.team): r.as_of for r in _dated()}
    assert stamps == {
        (1, "NE"): _at(2026, 9, 9, 12, 6, 21),
        (1, "SEA"): _at(2026, 9, 9, 12, 6, 21),
        (2, "NE"): _at(2026, 9, 16, 12, 34, 22),
        (2, "SEA"): _at(2026, 9, 16, 12, 34, 22),
    }  # week 3: no snapshot in the fixture after week 2's kickoffs, so no chart


def test_a_dated_row_is_its_snapshots_skill_row_with_its_slot() -> None:
    snapshot = [
        r for r in fixture_rows("depth_charts_2026.csv")
        if r["dt"] == "2026-09-09T12:06:21Z" and r["team"] == "SEA" and r["pos_grp"] == "3WR 1TE"
        and r["pos_abb"] in _SKILL and r["gsis_id"]
    ]  # fmt: skip
    mine = {(r.slot, r.depth_order, r.player_id) for r in _dated() if r.week == 1 and r.team == "SEA"}
    assert mine == {(f"{r['pos_abb']}_{r['pos_slot']}", int(r["pos_rank"]), r["gsis_id"]) for r in snapshot}


@pytest.fixture(scope="module")
def engine() -> Any:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    url = databases.build_with_alembic(_DATABASE)
    built = make_engine(sqlalchemy_url(url))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_the_rows_are_written_once(engine: Engine) -> None:
    rows = _weekly() + _dated()
    with engine.begin() as conn:
        first = charts.record_chart_rows(conn, rows)
        again = charts.record_chart_rows(conn, rows)
    assert first == len({(r.season, r.week, r.team, r.slot, r.depth_order, r.player_id, r.as_of) for r in rows})
    assert again == 0


def test_a_season_with_no_stored_kickoffs_is_refused(engine: Engine) -> None:
    with engine.begin() as conn, pytest.raises(SchemaDriftError, match="no stored kickoffs"):
        charts.ingest_depth_chart_weeks(conn, NflverseClient(FixtureFetcher()), 2016)
