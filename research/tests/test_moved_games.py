"""A moved game retired (Lane 110, B77b): the schedule ingest marks a stored game superseded when the
provider's week no longer lists its id but lists the same two clubs under another id, and the research
reads of the schedule leave a superseded row out.

The cases run the real ingest and mapper over a fake provider client against a migrated scratch database
and need PARITY_DATABASE_URL (skipped without it, run by CI).
"""

import os
from collections.abc import Iterator, Mapping, Sequence
from datetime import UTC, datetime
from typing import Final, cast

import pytest
from sqlalchemy import Engine, select

from research.db.engine import make_engine
from research.db.schema import PROVIDER_GAMES
from research.db.url import sqlalchemy_url
from research.nightly.reads.schedule import slates_by_club
from research.parity import databases
from research.pipeline.budget import FixedBudget
from research.pipeline.tank01.capture import stored_week_game_dates
from research.pipeline.tank01.client import Paths, Tank01Client
from research.pipeline.tank01.ingest import ingest_schedule
from research.pipeline.tank01.provider import Tank01Provider

_DATABASE: Final = "parity_test_moved_games"
SEASON: Final = 2026
WEEK: Final = 18
SATURDAY: Final = "20270109_BAL@PIT"  # the flexed Saturday game's id
SUNDAY: Final = "20270110_BAL@PIT"  # the same game as first listed, on the Sunday
OTHER: Final = "20270109_DAL@NYG"
DROPPED: Final = "20270109_KC@LV"
Game = Mapping[str, str]


def _game(game_id: str, home: str, away: str, day: str) -> Game:
    return {
        "gameID": game_id,
        "home": home,
        "away": away,
        "gameDate": day,
        "gameTime": "1:00p",
        "gameStatus": "Scheduled",
    }


SUNDAY_WEEK: Final = [
    _game(SUNDAY, "PIT", "BAL", "20270110"),
    _game(OTHER, "NYG", "DAL", "20270109"),
    _game(DROPPED, "LV", "KC", "20270109"),
]
SATURDAY_WEEK: Final = [_game(SATURDAY, "PIT", "BAL", "20270109"), _game(OTHER, "NYG", "DAL", "20270109")]


class _Client:
    """The provider's week-18 answer, whatever it is set to; every other week lists nothing."""

    def __init__(self, week: Sequence[Game]) -> None:
        self.week = list(week)

    def get(self, path: str, query: dict[str, str] | None = None) -> object:
        assert path == Paths.GAMES_FOR_WEEK
        return self.week if (query or {}).get("week") == str(WEEK) else []


def _ingest(engine: Engine, client: _Client) -> int:
    provider = Tank01Provider(cast(Tank01Client, client), season=SEASON)
    with engine.begin() as conn:
        return ingest_schedule(conn, provider, FixedBudget(18)).superseded


def _marks(engine: Engine) -> dict[str, str | None]:
    t = PROVIDER_GAMES
    with engine.connect() as conn:
        return {str(r.game_id): r.superseded_by for r in conn.execute(select(t.c.game_id, t.c.superseded_by))}


@pytest.fixture
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_a_game_listed_under_a_new_id_retires_its_old_row(engine: Engine) -> None:
    client = _Client(SUNDAY_WEEK)
    assert _ingest(engine, client) == 0
    client.week = SATURDAY_WEEK
    assert _ingest(engine, client) == 1
    # The moved game's old id names its new one; the new row and the unmoved game are games to play; a game
    # the week dropped with no pair under another id is left as it stands.
    assert _marks(engine) == {SUNDAY: SATURDAY, SATURDAY: None, OTHER: None, DROPPED: None}
    # Ingested again, nothing more is marked.
    assert _ingest(engine, client) == 0


def test_the_two_clubs_match_whichever_is_at_home(engine: Engine) -> None:
    client = _Client(SUNDAY_WEEK)
    _ingest(engine, client)
    client.week = [_game("20270109_PIT@BAL", "BAL", "PIT", "20270109")]
    assert _ingest(engine, client) == 1
    assert _marks(engine)[SUNDAY] == "20270109_PIT@BAL"


def test_an_id_listed_again_is_a_game_to_play_again(engine: Engine) -> None:
    client = _Client(SUNDAY_WEEK)
    _ingest(engine, client)
    client.week = SATURDAY_WEEK
    _ingest(engine, client)
    client.week = SUNDAY_WEEK
    _ingest(engine, client)
    marks = _marks(engine)
    assert marks[SUNDAY] is None
    assert marks[SATURDAY] == SUNDAY


def test_the_schedule_reads_leave_a_superseded_game_out(engine: Engine) -> None:
    client = _Client(SUNDAY_WEEK)
    _ingest(engine, client)
    client.week = SATURDAY_WEEK
    _ingest(engine, client)
    with engine.connect() as conn:
        # The lines feed asks Saturday alone: the moved game no longer adds its old Sunday.
        dates = stored_week_game_dates(conn, SEASON, datetime(2027, 1, 5, 12, tzinfo=UTC))
        assert dates == ("20270109",)
        # The run's slate: one week-18 game for each club of the moved game.
        pittsburgh = [game for game in slates_by_club(conn, SEASON)["PIT"] if game.week == WEEK]
    assert [game.kickoff.date().isoformat() for game in pittsburgh] == ["2027-01-09"]
