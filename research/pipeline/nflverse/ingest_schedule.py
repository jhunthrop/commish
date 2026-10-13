"""The schedule ingests (`ingestSchedule`, `ingestGameResults`, `ingestPointsAllowed` in ingest.ts).

One `games.csv` download covers every named season. The two narrowed writers exist for a store
that already holds every other schedule fact: re-running the full ingest to add one metric would
also write every row the upstream file has gained since, a data change nobody asked for.
"""

from collections.abc import Callable, Sequence

from sqlalchemy import Connection

from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.ingest import schedule_client
from research.pipeline.nflverse.schedule import (
    SCHEDULE_FILE,
    SCHEDULE_RELEASE,
    TeamGame,
    game_result_observations,
    map_schedule,
    points_allowed_observations,
    schedule_observations,
)
from research.pipeline.observations import TeamWeekObservation, record_team_observations


def _ingest(
    conn: Connection,
    client: NflverseClient,
    seasons: Sequence[int],
    observe: Callable[[Sequence[TeamGame]], list[TeamWeekObservation]],
) -> int:
    rows = schedule_client(client).get_csv(SCHEDULE_RELEASE, SCHEDULE_FILE)
    return record_team_observations(conn, observe(map_schedule(rows, seasons)))


def ingest_schedule(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> int:
    return _ingest(conn, client, seasons, schedule_observations)


def ingest_game_results(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> int:
    return _ingest(conn, client, seasons, game_result_observations)


def ingest_points_allowed(conn: Connection, client: NflverseClient, seasons: Sequence[int]) -> int:
    return _ingest(conn, client, seasons, points_allowed_observations)
