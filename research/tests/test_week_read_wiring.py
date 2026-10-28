"""The roll-over's wiring on the real tables (the Lane 256 review's M4, Lane 265): the 2026-10-27 bug was the
board week read off the wrong week, so these run the real `read_week_facts` (the board, projection and finals
lookups, the club-week filter) and the assembly's promise (`_served_week`, `reads_due_at`) against a migrated
scratch database seeded with one week's roll-over: week 7's finals held Tuesday 04:00 UTC, the board from week 8
published Tuesday 06:30 UTC (after the Tuesday run), week 8's projection first captured Tuesday 10:00 UTC. Needs
PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped without it."""

import os
from collections.abc import Iterator
from datetime import UTC, date, datetime
from typing import Final

import pytest
from sqlalchemy import Engine, insert

from research.capsules.week.collect import read_week_facts
from research.capsules.week.rollover import ReadsDue
from research.db.engine import make_engine
from research.db.schema import (
    CAPTURE_SNAPSHOTS,
    PROVIDER_GAMES,
    PUBLISHED_BOARDS,
    TANK01_PROJECTION_ROWS,
    TEAM_WEEK_OBSERVATIONS,
)
from research.db.url import sqlalchemy_url
from research.nightly.assemble import _served_week, _states, reads_due_at
from research.nightly.reads.schedule import slates_by_club
from research.parity import databases

_DATABASE: Final = "parity_lane265_week_read_wiring"
_SEASON: Final = 2026
_WEEK: Final = 8
# Week 7: Arizona at the Rams Sunday 25 October, Houston at Seattle Monday night. Week 8: the Rams at Arizona
# Thursday 29 October, Seattle at Houston Sunday. Week 9: both again, so a club whose week 8 game has kicked off
# has a week ahead the filter must leave out.
_GAMES: Final = (
    ("20261025_ARI@LAR", 7, "LAR", "ARI", date(2026, 10, 25), "1:00p"),
    ("20261026_HOU@SEA", 7, "SEA", "HOU", date(2026, 10, 26), "8:15p"),
    ("20261029_LAR@ARI", 8, "ARI", "LAR", date(2026, 10, 29), "8:15p"),
    ("20261101_SEA@HOU", 8, "HOU", "SEA", date(2026, 11, 1), "1:00p"),
    ("20261108_ARI@LAR", 9, "LAR", "ARI", date(2026, 11, 8), "1:00p"),
    ("20261108_HOU@SEA", 9, "SEA", "HOU", date(2026, 11, 8), "4:05p"),
)
_FINALS_HELD: Final = datetime(2026, 10, 27, 4, 0, tzinfo=UTC)
_BOARD_PUBLISHED: Final = datetime(2026, 10, 27, 6, 30, tzinfo=UTC)
_PROJECTION_CAPTURED: Final = datetime(2026, 10, 27, 10, 0, tzinfo=UTC)
_TUESDAY_RUN: Final = datetime(2026, 10, 27, 5, 50, tzinfo=UTC)
_WEDNESDAY_RUN: Final = datetime(2026, 10, 28, 5, 30, tzinfo=UTC)
_AFTER_THURSDAY_KICKOFF: Final = datetime(2026, 10, 30, 1, 0, tzinfo=UTC)
_PLAYER: Final = "00-0039075"


def _seed(engine: Engine) -> None:
    with engine.begin() as conn:
        conn.execute(
            insert(PROVIDER_GAMES),
            [
                {"game_id": gid, "season": _SEASON, "week": week, "home_team": home, "away_team": away,
                 "game_date": day, "kickoff_et": kickoff, "status": "scheduled"}
                for gid, week, home, away, day, kickoff in _GAMES
            ],
        )  # fmt: skip
        # Week 7's results, in the store's codes (the Rams are LA there).
        conn.execute(
            insert(TEAM_WEEK_OBSERVATIONS),
            [
                {"season": _SEASON, "week": 7, "team": team, "source": "nflverse_kickoff", "metric": "game_result",
                 "value": value, "as_of": _FINALS_HELD}
                for team, value in (("LA", 1), ("ARI", 0), ("SEA", 1), ("HOU", 0))
            ],
        )  # fmt: skip
        conn.execute(
            insert(PUBLISHED_BOARDS).values(
                season=_SEASON, format="ppr", player_id=_PLAYER, run_id="2026-10-27T05", rank=1, position_rank=1,
                order_basis="rest_of_season", refreshed=_BOARD_PUBLISHED, published_at=_BOARD_PUBLISHED,
                from_week=_WEEK,
            )
        )  # fmt: skip
        snapshot = conn.execute(
            insert(CAPTURE_SNAPSHOTS)
            .values(source="tank01_projections", captured_at=_PROJECTION_CAPTURED, digest="d", payload={})
            .returning(CAPTURE_SNAPSHOTS.c.id)
        ).scalar_one()
        conn.execute(
            insert(TANK01_PROJECTION_ROWS).values(
                snapshot_id=snapshot, provider_player_id=_PLAYER, captured_at=_PROJECTION_CAPTURED, season=_SEASON,
                week=_WEEK, position="RB", team="SEA", ppr_points=15.2, half_points=13.0, standard_points=11.0,
            )
        )  # fmt: skip


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    _seed(built)
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_the_tuesday_run_reads_board_week_8_and_waits(engine: Engine) -> None:
    with engine.connect() as conn:
        facts = read_week_facts(conn, _SEASON, [], _TUESDAY_RUN)
    assert facts is not None and facts.board_week == _WEEK
    assert not facts.rollover.ready
    assert facts.rollover.waits_on == ("the board from week 8", "week 8's published projection")
    # The 28 clubs the seed gives no game are on a bye that week.
    assert {club for club, cw in facts.weeks.items() if not cw.bye} == {"LAR", "ARI", "SEA", "HOU"}
    assert {cw.week for cw in facts.weeks.values()} == {_WEEK}


def test_the_wednesday_run_rolls_over(engine: Engine) -> None:
    with engine.connect() as conn:
        facts = read_week_facts(conn, _SEASON, [], _WEDNESDAY_RUN)
    assert facts is not None and facts.board_week == _WEEK and facts.rollover.ready
    assert facts.rollover.waits_on == ()


def test_a_club_whose_board_week_game_has_kicked_off_has_no_week_read_for_the_week_after(engine: Engine) -> None:
    """After Thursday night's kickoff the Rams and Arizona have week 9 ahead: no sheet is built for it."""
    with engine.connect() as conn:
        facts = read_week_facts(conn, _SEASON, [], _AFTER_THURSDAY_KICKOFF)
    assert facts is not None and facts.board_week == _WEEK
    assert {club for club, cw in facts.weeks.items() if not cw.bye} == {"SEA", "HOU"}
    assert "LAR" not in facts.weeks and "ARI" not in facts.weeks
    assert {cw.week for cw in facts.weeks.values()} == {_WEEK}


def test_the_tuesday_page_promises_the_wednesday_nightly_and_the_wednesday_page_none(engine: Engine) -> None:
    """`_served_week` on the Tuesday clock, the run's own board from week 8: the Wednesday 05:30 UTC nightly,
    Tuesday night; the run judged on the Wednesday clock has rolled over and promises nothing."""
    with engine.connect() as conn:
        games = slates_by_club(conn, _SEASON)
        tuesday = _served_week(conn, _TUESDAY_RUN, games, _states(conn, games, _TUESDAY_RUN), _WEEK, [], _TUESDAY_RUN)
        wednesday = reads_due_at(conn, _WEEK, games, _WEEK, _WEDNESDAY_RUN)
        preseason_board = reads_due_at(conn, _WEEK, games, None, _TUESDAY_RUN)
    assert tuesday.due == ReadsDue(_WEEK, _WEDNESDAY_RUN)
    assert tuesday.due.json() == {"week": _WEEK, "night": "Tuesday", "at": "2026-10-28T05:30:00.000Z"}
    assert wednesday is None
    # A run whose own board does not cover week 8 names the last nightly before Thursday's kickoff.
    assert preseason_board == ReadsDue(_WEEK, datetime(2026, 10, 29, 5, 30, tzinfo=UTC))


def test_the_assembly_judges_the_promise_at_the_steps_instant(engine: Engine) -> None:
    """The review's L5: a step that judged at Tuesday 05:50 with the run assembled after the projection landed
    still carries the step's verdict, the promise, rather than none."""
    later = datetime(2026, 10, 27, 10, 30, tzinfo=UTC)
    with engine.connect() as conn:
        games = slates_by_club(conn, _SEASON)
        states = _states(conn, games, later)
        judged = _served_week(conn, later, games, states, _WEEK, [], _TUESDAY_RUN)
    assert judged.due == ReadsDue(_WEEK, _WEDNESDAY_RUN)
