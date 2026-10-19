"""A SEASON'S STAT LINES AND ITS GAME RESULTS, ONE UNIT (Lane 78).

The operator's `season` command and the weekly pass's stats step both write a season's
participation, stat lines and team edges, then each game's result once nflverse posts its score (the
feed's own final flag, which the nightly's game log and the API's played rule read). Neither commits
inside: the caller commits after both, so the store holds a week's lines with its result, or neither.
"""

from collections.abc import Mapping
from datetime import datetime

from sqlalchemy import Connection

from research.pipeline.nflverse import ingest, ingest_schedule
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.ingest import SeasonIngestReport
from research.pipeline.nflverse.players import PlayerUniverse


def ingest_season_and_results(  # noqa: PLR0913 - ingest_season's own arguments, passed through
    conn: Connection,
    client: NflverseClient,
    universe: PlayerUniverse,
    season: int,
    schedule_as_of: Mapping[float, datetime] | None = None,
    *,
    release: str | None = None,
    completions: bool = True,
) -> SeasonIngestReport:
    """`ingest.ingest_season` (its `release` and `completions` as it reads them), then
    `ingest_schedule.ingest_game_results` for the same season."""
    report = ingest.ingest_season(
        conn, client, universe, season, schedule_as_of, release=release, completions=completions
    )
    ingest_schedule.ingest_game_results(conn, client, [season])
    return report
