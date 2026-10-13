"""The provider store's rollover rule against a real Postgres: a new season starts clean.

Needs PARITY_DATABASE_URL (a server where the harness may create `parity_*` databases); skipped
without it, and run by CI, which sets it.
"""

import os
from datetime import UTC, date, datetime

import pytest
from sqlalchemy import func, insert, select

from research.db.engine import make_engine
from research.db.schema import PROVIDER_GAMES, PROVIDER_PLAYERS, PROVIDER_STAT_LINES, PROVIDER_WEEKS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.tank01.ingest import retire_other_seasons

_DATABASE = "parity_test_rollover"
_OLD, _NEW = 2025, 2026


def _game(season: int, game_id: str) -> dict[str, object]:
    return {
        "game_id": game_id,
        "season": season,
        "week": 1,
        "home_team": "PHI",
        "away_team": "DAL",
        "game_date": date(season, 9, 10),
        "kickoff_et": "8:20p",
        "status": "final",
    }


def _week(season: int) -> dict[str, object]:
    return {
        "season": season,
        "week": 1,
        "status": "final",
        "version": 1,
        "games_total": 1,
        "games_final": 1,
        "updated_at": datetime(season, 9, 11, tzinfo=UTC),
    }


def _line(season: int) -> dict[str, object]:
    zeros = {c.name: 0 for c in PROVIDER_STAT_LINES.columns if c.name not in ("season", "week", "provider_player_id")}
    return {**zeros, "season": season, "week": 1, "provider_player_id": "4040"}


@pytest.mark.skipif("PARITY_DATABASE_URL" not in os.environ, reason="needs a Postgres for scratch databases")
def test_a_new_season_retires_every_row_of_the_old_one() -> None:
    url = databases.build_with_alembic(_DATABASE)
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.begin() as conn:
            conn.execute(insert(PROVIDER_PLAYERS).values(id="4040", name="A. Player", position="WR", team="PHI"))
            conn.execute(
                insert(PROVIDER_GAMES).values([_game(_OLD, "20250910_DAL@PHI"), _game(_NEW, "20260910_DAL@PHI")])
            )
            conn.execute(insert(PROVIDER_WEEKS).values([_week(_OLD), _week(_NEW)]))
            conn.execute(insert(PROVIDER_STAT_LINES).values([_line(_OLD), _line(_NEW)]))
            retired = retire_other_seasons(conn, _NEW)
            left = {
                table.name: conn.execute(select(table.c.season, func.count()).group_by(table.c.season)).all()
                for table in (PROVIDER_GAMES, PROVIDER_WEEKS, PROVIDER_STAT_LINES)
            }
        assert retired == len(left)  # one old-season row in each of the three tables
        assert all(rows == [(_NEW, 1)] for rows in left.values()), left
    finally:
        engine.dispose()
        databases.drop(_DATABASE)
