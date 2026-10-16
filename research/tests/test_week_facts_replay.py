"""The register's replay of the week facts (Lane 66a, item 6; the round 4 preregistration, section 5):
every hourly read of the game figures and the forecast is a stamped row that no later read overwrites,
so the round reads, at any instant of week 7 or later, exactly the figures the site held then (the
newest at or before the instant, the rule the API's week facts read with)."""

import json
import os
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import Engine, insert

from research.db.engine import make_engine
from research.db.schema import CAPTURE_SNAPSHOTS, PROVIDER_GAMES
from research.db.url import sqlalchemy_url
from research.model.reads.teams import team_observations_as_of
from research.parity import databases
from research.pipeline.tank01.lines import LINES_SOURCE, LinesMetric, backfill_lines, record_checked_lines

_DATA = Path(__file__).resolve().parent / "testdata" / "tank01-lines"
_DATABASE = "parity_test_week_facts_replay"
CAPTURED = datetime(2026, 10, 12, 23, 59, 11, tzinfo=UTC)
CHECKED = CAPTURED + timedelta(hours=1)


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    payload = json.loads((_DATA / "odds-2026-10-12T23.json").read_text(encoding="utf-8"))
    with built.begin() as conn:
        conn.execute(
            insert(PROVIDER_GAMES).values(
                game_id="20261012_BUF@LAR", season=2026, week=6, home_team="LAR", away_team="BUF",
                game_date=date(2026, 10, 12), kickoff_et="8:15p", status="scheduled",
            )
        )  # fmt: skip
        conn.execute(
            insert(CAPTURE_SNAPSHOTS).values(
                source="tank01_betting_odds", captured_at=CAPTURED, digest="d", payload=payload
            )
        )
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_each_read_is_its_own_stamped_row_and_a_replay_takes_the_newest_at_its_instant(engine: Engine) -> None:
    with engine.begin() as conn:
        assert backfill_lines(conn).written > 0
        assert backfill_lines(conn).written == 0
        # The next hour's pass found the payload unchanged: the same figures, read again, stamped then.
        assert record_checked_lines(conn, CHECKED).written > 0
        before = team_observations_as_of(conn, 2026, 6, CAPTURED - timedelta(seconds=1), LINES_SOURCE)
        at_capture = team_observations_as_of(conn, 2026, 6, CAPTURED + timedelta(minutes=30), LINES_SOURCE)
        after_check = team_observations_as_of(conn, 2026, 6, CHECKED, LINES_SOURCE)
    assert before == []
    assert {row.as_of for row in at_capture} == {CAPTURED}
    assert {row.as_of for row in after_check} == {CHECKED}
    spreads = {row.team: row.value for row in after_check if row.metric == LinesMetric.POINT_SPREAD}
    assert spreads == {"LA": 3.5, "BUF": -3.5}
