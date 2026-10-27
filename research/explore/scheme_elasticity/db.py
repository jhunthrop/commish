"""THE PROBE'S TWO CONNECTIONS: the lane's scratch database (written) and dev (read only, guarded).

The scratch must be a `lane245_` database on the local 5433 server (`ros.scratch.check_scratch_url`).
Dev is opened in a read-only transaction with round 2's `guard_queries` on the closed seasons, so a
statement binding 2024, 2025 or 2026 is refused before it runs; every dev query below binds its
seasons as `seasons`.
"""

from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Final

import pandas as pd
from sqlalchemy import Connection, Engine, text

from research.db.engine import make_engine
from research.db.url import sqlalchemy_url
from research.explore.scheme_elasticity.seasons import CLOSED_SEASONS, admit_season
from research.model.ros.scratch import check_scratch_url
from research.model.weekly2.guard import guard_queries

SCRATCH_PREFIXES: Final = ("lane245_",)


def scratch_engine(url: str) -> Engine:
    check_scratch_url(url, SCRATCH_PREFIXES)
    return make_engine(sqlalchemy_url(url))


@contextmanager
def dev_reader(url: str) -> Iterator[Connection]:
    """A read-only, season-guarded connection on dev."""
    engine = make_engine(sqlalchemy_url(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("set transaction read only"))
            guard_queries(conn, CLOSED_SEASONS)
            yield conn
    finally:
        engine.dispose()


def admitted(seasons: Sequence[int]) -> list[int]:
    return [admit_season(s) for s in seasons]


_PLAYS: Final = text(
    """
    select game_id, play_id, season, week, posteam, defteam, qb_dropback, qb_scramble, rush_attempt,
           pass_attempt, sack, two_point_attempt, qb_kneel, qb_spike, passer_player_id,
           rusher_player_id, receiver_player_id
    from research.nflverse_pbp_plays
    where season = any(:seasons) and week <= 17 and posteam is not null and defteam is not null
    """
)

# The plays' outcome columns, read only after the plan commit (the analysis, never the coverage).
_PLAY_OUTCOMES: Final = text(
    """
    select game_id, play_id, yards_gained, complete_pass, interception, fumble_lost, pass_touchdown,
           rush_touchdown, td_player_id
    from research.nflverse_pbp_plays
    where season = any(:seasons) and week <= 17
    """
)


def plays(conn: Connection, seasons: Sequence[int]) -> pd.DataFrame:
    """The plays' roles (who dropped back, carried, was targeted) and no outcome."""
    return pd.DataFrame(conn.execute(_PLAYS, {"seasons": admitted(seasons)}).mappings().all())


def play_outcomes(conn: Connection, seasons: Sequence[int]) -> pd.DataFrame:
    return pd.DataFrame(conn.execute(_PLAY_OUTCOMES, {"seasons": admitted(seasons)}).mappings().all())


def write_frame(engine: Engine, frame: pd.DataFrame, table: str) -> None:
    with engine.begin() as conn:
        frame.to_sql(table, conn, if_exists="replace", index=False)


def read_frame(engine: Engine, table: str, seasons: Sequence[int]) -> pd.DataFrame:
    with engine.connect() as conn:
        query = text(f"select * from {table} where season = any(:seasons)")
        return pd.DataFrame(conn.execute(query, {"seasons": admitted(seasons)}).mappings().all())
