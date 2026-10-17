"""Every mapped player's snaps, not only the ones with a stat line (round 4 amendment 3).

A played game is a game with an offensive snap, so the participation step must keep the snap
observations of a backup who dressed and took snaps without a touch, keep a stat line's zero snaps
as a zero, and say per season what it read, what it wrote and whom it could not map."""

import csv
import io
import os
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Engine, select

from research.db.engine import make_engine
from research.db.schema import PLAYER_WEEK_OBSERVATIONS
from research.db.url import sqlalchemy_url
from research.parity import databases
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS
from research.pipeline.nflverse.csv import CsvRow
from research.pipeline.nflverse.ingest import ingest_season
from research.pipeline.nflverse.participation import (
    NflverseSource,
    ParticipationMetric,
    SnapCountTally,
    map_participation,
    participation_observations,
)
from research.pipeline.nflverse.players import NflPlayer, PlayerUniverse, record_nfl_players
from research.tests.nflverse_fixtures import FixtureFetcher

_DATABASE = "parity_test_participation_snaps"
_SEASON = 2023
_GAME = "2023_01_DET_KC"
_PFR_GAME = "202309070kan"
# The end of the game's UTC day (7 September 2023) plus the publication lag.
_GAME_AS_OF = datetime(2023, 9, 8, tzinfo=UTC) + timedelta(hours=PUBLICATION_LAG_HOURS)

BACKUP = NflPlayer("00-0000001", "BackAl00", None, "Al Backup", "WR", "KC", 2021, 2023)
STARTER = NflPlayer("00-0000002", "StarBo00", None, "Bo Starter", "RB", "KC", 2019, 2023)
LINEMAN = NflPlayer("00-0000003", "LineCa00", None, "Cy Lineman", "T", "KC", 2018, 2023)
PLAYERS = (BACKUP, STARTER, LINEMAN)
_TALLY = SnapCountTally(rows_read=4, mapped=2, unmapped=1, other_positions=1)
_SNAP_METRICS = 2  # offensive snaps and his club's offensive snaps


def _snap(player: str, pfr_id: str, position: str, snaps: int, game_type: str = "REG") -> CsvRow:
    return {
        "game_id": _GAME,
        "pfr_game_id": _PFR_GAME,
        "season": str(_SEASON),
        "game_type": game_type,
        "week": "1",
        "player": player,
        "pfr_player_id": pfr_id,
        "position": position,
        "team": "KC",
        "opponent": "DET",
        "offense_snaps": str(snaps),
    }


SNAP_COUNTS: tuple[CsvRow, ...] = (
    _snap("Al Backup", "BackAl00", "WR", 12),  # snaps and no stat line: he played
    _snap("Bo Starter", "StarBo00", "RB", 0),  # a stat line and no offensive snap: he did not
    _snap("Cy Lineman", "LineCa00", "T", 64),  # read, outside the projected positions
    _snap("Gus Ghost", "GhostGu00", "WR", 5),  # a projected position the universe cannot map
    _snap("Al Backup", "BackAl00", "WR", 30, game_type="POST"),  # not the regular season: not read
)
PLAYER_WEEK: tuple[CsvRow, ...] = (
    {
        "player_id": STARTER.id,
        "player_display_name": STARTER.name,
        "position": "RB",
        "season": str(_SEASON),
        "week": "1",
        "season_type": "REG",
        "team": "KC",
        "targets": "0",
        "carries": "0",
        "attempts": "0",
        "receptions": "0",
    },
)


def _observations(rows: Sequence[CsvRow] = SNAP_COUNTS) -> dict[tuple[str, str, str], tuple[float, datetime]]:
    mapped = map_participation(rows, PLAYER_WEEK, PlayerUniverse(PLAYERS))
    return {
        (o.player_id, o.source, o.metric): (o.value, o.as_of) for o in participation_observations(mapped.participation)
    }


def test_a_player_with_snaps_and_no_stat_line_keeps_his_snap_observations() -> None:
    assert not any(row["player_id"] == BACKUP.id for row in PLAYER_WEEK)
    found = _observations()
    assert found[(BACKUP.id, NflverseSource.SNAP_COUNTS, ParticipationMetric.OFFENSIVE_SNAPS)] == (12.0, _GAME_AS_OF)
    # His club's offensive snaps are the most any of its players took in the game, the lineman's 64.
    assert found[(BACKUP.id, NflverseSource.SNAP_COUNTS, ParticipationMetric.TEAM_OFFENSIVE_SNAPS)] == (
        64.0,
        _GAME_AS_OF,
    )


def test_a_stat_line_with_zero_snaps_keeps_its_zero() -> None:
    found = _observations()
    assert found[(STARTER.id, NflverseSource.SNAP_COUNTS, ParticipationMetric.OFFENSIVE_SNAPS)] == (0.0, _GAME_AS_OF)


def test_an_unmapped_or_non_projected_snap_row_is_counted_and_never_invented() -> None:
    found = _observations()
    assert {player for player, _, _ in found} == {BACKUP.id, STARTER.id}
    assert map_participation(SNAP_COUNTS, PLAYER_WEEK, PlayerUniverse(PLAYERS)).snap_counts == _TALLY


def _csv(rows: Sequence[CsvRow]) -> bytes:
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode()


def _client() -> NflverseClient:
    bodies = {
        f"snap_counts_{_SEASON}.csv": _csv(SNAP_COUNTS),
        f"stats_player_week_{_SEASON}.csv": _csv(PLAYER_WEEK),
    }
    return NflverseClient(FixtureFetcher(bodies=bodies))


@pytest.fixture(scope="module")
def engine() -> Iterator[Engine]:
    if "PARITY_DATABASE_URL" not in os.environ:
        pytest.skip("needs a Postgres for scratch databases")
    built = make_engine(sqlalchemy_url(databases.build_with_alembic(_DATABASE)))
    try:
        yield built
    finally:
        built.dispose()
        databases.drop(_DATABASE)


def test_the_season_reports_its_snap_counts_and_a_rerun_writes_nothing(engine: Engine) -> None:
    table = PLAYER_WEEK_OBSERVATIONS
    with engine.begin() as conn:
        record_nfl_players(conn, PLAYERS)
        first = ingest_season(conn, _client(), PlayerUniverse(PLAYERS), _SEASON)
        snaps = dict(
            conn.execute(
                select(table.c.player_id, table.c.value).where(
                    table.c.source == NflverseSource.SNAP_COUNTS,
                    table.c.metric == ParticipationMetric.OFFENSIVE_SNAPS,
                )
            ).all()
        )
    assert first.snap_counts == _TALLY
    assert first.snap_observations_written == _TALLY.mapped * _SNAP_METRICS
    assert snaps == {BACKUP.id: 12.0, STARTER.id: 0.0}
    with engine.begin() as conn:
        again = ingest_season(conn, _client(), PlayerUniverse(PLAYERS), _SEASON)
    assert (again.snap_observations_written, again.observations_written) == (0, 0)
    assert again.snap_counts == first.snap_counts
