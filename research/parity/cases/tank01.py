"""The stats-provider cases: the roster and its weekly lines, the fixtures, the ADP column, the crosswalk.

Recorded once against the live Tank01 API for the 2026 season: the player list and teams feed,
every week's fixtures (1 to 18), the box scores of weeks 1 and 2, and the PPR ADP feed. The
roster-and-lines case runs the seed with the provider's last week set to 2, which is the same
seed with a shorter loop; every other method is the provider's own.
"""

import json
import os
from datetime import UTC, datetime

from sqlalchemy import Connection

from research.errors import ConfigurationError
from research.parity.case import Case, Recording, RunContext, Script
from research.parity.cases.nflverse_season import NOW, UNIVERSE
from research.parity.cases.steps import cli
from research.parity.cases.tables import (
    PLAYER_CROSSWALK,
    PLAYERS,
    PROVIDER_GAMES,
    PROVIDER_PLAYERS,
    PROVIDER_STAT_LINES,
)
from research.parity.record import RecordSpec
from research.pipeline.budget import UnmeteredBudget
from research.pipeline.http import Fetcher
from research.pipeline.tank01.client import API_KEY_ENV, Paths, Tank01Client
from research.pipeline.tank01.ingest import backfill_headshots, ingest_adp, ingest_roster_and_lines, ingest_schedule
from research.pipeline.tank01.mapping import ADP_TYPE, SEASON_TYPE, WEEKS_LAST, map_games
from research.pipeline.tank01.provider import Tank01Provider

SEASON = 2026
BOX_SCORE_WEEKS = 2
REPLAY_KEY = "replay"  # The replay never checks the key; a real one never enters a fixture.


def _live_client(fetcher: Fetcher) -> Tank01Client:
    key = os.environ.get(API_KEY_ENV, "")
    if key == "":
        raise ConfigurationError(f"{API_KEY_ENV} must be set to record the Tank01 fixtures.")
    return Tank01Client(fetcher=fetcher, api_key=key)


def _games_url(client: Tank01Client, week: int) -> str:
    return client.url(Paths.GAMES_FOR_WEEK, {"week": str(week), "season": str(SEASON), "seasonType": SEASON_TYPE})


def _specs(fetcher: Fetcher) -> list[RecordSpec]:
    client = _live_client(fetcher)
    headers = {"x-rapidapi-key": client.api_key, "x-rapidapi-host": client.host}
    specs = [
        RecordSpec(url=client.url(Paths.PLAYER_LIST), file="player_list.json.gz", request_headers=headers),
        RecordSpec(url=client.url(Paths.TEAMS), file="teams.json.gz", request_headers=headers),
        RecordSpec(url=client.url(Paths.ADP, {"adpType": ADP_TYPE}), file="adp_ppr.json.gz", request_headers=headers),
    ]
    for week in range(1, WEEKS_LAST + 1):
        specs.append(
            RecordSpec(url=_games_url(client, week), file=f"games_week_{week}.json.gz", request_headers=headers)
        )
    for week in range(1, BOX_SCORE_WEEKS + 1):
        response = fetcher.get(_games_url(client, week), headers)
        body = json.loads(response.text()).get("body")
        for game in map_games(body, week):
            specs.append(
                RecordSpec(
                    url=client.url(Paths.BOX_SCORE, {"gameID": game.game_id}),
                    file=f"box_{game.game_id.replace('@', '_at_')}.json.gz",
                    request_headers=headers,
                )
            )
    return specs


TANK01 = Recording(
    fixture_set="tank01-2026",
    specs=_specs,
    note="Tank01, season 2026, recorded from the live API: the player list and teams feed, the fixtures of every "
    "week 1 to 18, the box scores of weeks 1 and 2, and the PPR ADP feed. Request headers (the key) are never recorded.",
)


def _provider(ctx: RunContext, last_week: int = WEEKS_LAST) -> Tank01Provider:
    return Tank01Provider(Tank01Client(ctx.fetcher, REPLAY_KEY), season=SEASON, last_week_of_season=last_week)


def _roster_and_lines(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    ingest_roster_and_lines(conn, _provider(ctx, BOX_SCORE_WEEKS), checkpoint=ctx.checkpoint)
    return ()


def _schedule(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    ingest_schedule(conn, _provider(ctx), UnmeteredBudget())
    return ()


def _adp(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    # Two providers, as `npm run seed` and `npm run stats:adp` are two processes: each pays its own
    # roster read, and the harness checks both sides asked for exactly the same recordings.
    ingest_roster_and_lines(conn, _provider(ctx, 0))
    ingest_adp(conn, _provider(ctx), UnmeteredBudget())
    return ()


def _headshots(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    ingest_roster_and_lines(conn, _provider(ctx, 0))
    backfill_headshots(conn, _provider(ctx))
    return ()


def crosswalk_script(conn: Connection, ctx: RunContext) -> int:
    """`build-crosswalk.ts`: the universe refreshed, then the defenses seeded, resolved, recorded."""
    return max(cli(conn, ctx, ["universe"]), cli(conn, ctx, ["crosswalk"]))


def _crosswalk(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    ingest_roster_and_lines(conn, _provider(ctx, 0))
    return (crosswalk_script(conn, ctx),)


CASES: tuple[Case, ...] = (
    Case(
        name="tank01-roster-and-lines",
        summary="the provider roster into players, then weeks 1-2 of box scores into player_stat_lines (seedPlayers)",
        fixture_sets=("tank01-2026",),
        tables=(PROVIDER_PLAYERS, PROVIDER_STAT_LINES),
        run_python=_roster_and_lines,
        now=NOW,
        recordings=(TANK01,),
    ),
    Case(
        name="tank01-schedule",
        summary="every 2026 fixture, weeks 1-18, into nfl_games (the stats pipeline's schedule walk)",
        fixture_sets=("tank01-2026",),
        tables=(PROVIDER_GAMES,),
        run_python=_schedule,
        now=NOW,
    ),
    Case(
        name="tank01-adp",
        summary="the PPR ADP feed onto players.adp and pos_adp (an update, never an insert)",
        fixture_sets=("tank01-2026",),
        tables=(PROVIDER_PLAYERS,),
        run_python=_adp,
        now=NOW,
    ),
    Case(
        name="tank01-headshots",
        summary="backfill-headshots.ts RE-ASSEMBLED (its provider needs Redis): headshot URLs onto existing players rows",
        fixture_sets=("tank01-2026",),
        tables=(PROVIDER_PLAYERS,),
        run_python=_headshots,
        now=NOW,
    ),
    Case(
        name="crosswalk",
        summary="build-crosswalk.ts run as is: the provider roster against the universe, defenses seeded",
        fixture_sets=("nflverse-universe", "tank01-2026"),
        tables=(PLAYERS.as_setup(), PROVIDER_PLAYERS.as_setup(), PLAYER_CROSSWALK),
        ts_scripts=(Script("research-ts/scripts/build-crosswalk.ts"),),
        run_python=_crosswalk,
        now=datetime(2026, 10, 12, 5, 0, tzinfo=UTC),
        recordings=(UNIVERSE,),
    ),
)
