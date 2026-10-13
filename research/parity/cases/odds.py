"""The props cases: the live snapshot with its name resolution, and the historical backfill run as
the operator runs it (`scripts/odds-props-backfill.ts --budget=1 --seasons=2025`, unmodified)."""

import json
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection

from research.errors import ConfigurationError
from research.parity.case import Case, Recording, RunContext, Script
from research.parity.cases.nflverse_season import NOW
from research.parity.cases.preseason import PRESEASON_NOW
from research.parity.cases.steps import cli, schedule, universe
from research.parity.cases.tables import (
    PLAYER_PROP_OBSERVATIONS as PROP_OBSERVATIONS,
)
from research.parity.cases.tables import (
    PLAYERS,
    PROPS_PLAYER_MAP,
    TEAM_WEEK_OBSERVATIONS,
)
from research.parity.record import RecordSpec
from research.parity.replay import FIXTURES_ROOT, ReplayFetcher
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.schedule import ScheduleMetric, map_schedule, schedule_observations
from research.pipeline.odds.backfill import (
    SNAPSHOT_OFFSET_HOURS,
    WEEK_WINDOW_DAYS,
    to_historical_date_param,
)
from research.pipeline.odds.ingest import (
    KickoffGate,
    resolve_all_prop_names,
    run_odds_snapshot,
    run_props_preseason_snapshot,
    select_upcoming_events,
)
from research.pipeline.odds.props import API_KEY_ENV, ODDS_PARAMS, SPORT_KEY, odds_url, parse_odds_event
from research.pipeline.preseason.ingest import first_kickoff_for

REPLAY_KEY = "replay"
BACKFILL_SEASON = 2025


def _key() -> str:
    key = os.environ.get(API_KEY_ENV, "")
    if key == "":
        raise ConfigurationError(f"{API_KEY_ENV} must be set to record the odds fixtures.")
    return key


def _snapshot_specs(fetcher: Fetcher) -> list[RecordSpec]:
    key = _key()
    _, selected, _ = select_upcoming_events(fetcher, key, NOW)
    specs = [RecordSpec(url=odds_url(f"/sports/{SPORT_KEY}/events", key), file="events.json.gz")]
    for event in selected:
        url = odds_url(f"/sports/{SPORT_KEY}/events/{event.id}/odds", key, dict(ODDS_PARAMS))
        specs.append(RecordSpec(url=url, file=f"event_odds_{event.id}.json.gz"))
    return specs


def _week_one_kickoff(season: int) -> datetime:
    """The same instant `kickoffInstantsByWeek` stores for week 1, read off the recorded games.csv."""
    schedule = ReplayFetcher([FIXTURES_ROOT / "nflverse-schedule"])
    rows = NflverseClient(schedule, base_url="https://raw.githubusercontent.com/nflverse/nfldata/master/").get_csv(
        "data", "games.csv"
    )
    observations = schedule_observations(map_schedule(rows, [season]))
    return min(o.as_of for o in observations if o.week == 1 and o.metric == ScheduleMetric.KICKOFF_INSTANT)


def _backfill_specs(fetcher: Fetcher) -> list[RecordSpec]:
    key = _key()
    kickoff = _week_one_kickoff(BACKFILL_SEASON)
    date = to_historical_date_param(kickoff - timedelta(hours=SNAPSHOT_OFFSET_HOURS))
    events_url = odds_url(f"/historical/sports/{SPORT_KEY}/events", key, {"date": date})
    page = json.loads(fetcher.get(events_url).text())
    events = [parse_odds_event(raw, "data") for raw in page["data"]]
    window_end = kickoff + timedelta(days=WEEK_WINDOW_DAYS)
    in_window = [e for e in events if kickoff <= e.commence_time < window_end][:BACKFILL_RUNS]
    params = {"date": date, **dict(ODDS_PARAMS)}
    return [
        RecordSpec(url=events_url, file="historical_events_week_1.json.gz"),
        *(
            RecordSpec(
                url=odds_url(f"/historical/sports/{SPORT_KEY}/events/{event.id}/odds", key, params),
                file=f"historical_event_odds_{event.id}.json.gz",
            )
            for event in in_window
        ),
    ]


SNAPSHOT = Recording(
    fixture_set="odds-snapshot-2026-10-12",
    specs=_snapshot_specs,
    note="The Odds API, recorded 2026-10-12: the NFL events list and the five prop markets for every event the "
    "snapshot selects (kicking off within fourteen days of 05:00 UTC, earliest first, at most twenty). The key is "
    "stripped from every recorded URL.",
)
# One event per run of the one-credit backfill: the first pass, and the rerun that resumes it.
BACKFILL_RUNS = 2
BACKFILL = Recording(
    fixture_set="odds-backfill-2025-week-1",
    specs=_backfill_specs,
    note="The Odds API's historical archive at eight hours before 2025's first kickoff: the events page and the "
    "first two in-window events' five prop markets. A run with a budget of one credit reads the first; the same "
    "command run again resumes past the archived event and reads the second (the rerun pass).",
)


def _snapshot_and_resolve(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """The season-week job's props step (`realSnapshotProps`), then the preseason job's resolve."""
    universe(conn, ctx)
    run_odds_snapshot(conn, ctx.fetcher, REPLAY_KEY, ctx.now)
    resolve_all_prop_names(conn)
    return ()


def _preseason_job(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """The props-preseason-snapshot job (`snapshotPreseasonProps`) fired before the 2026 opener
    (`firedAt` August 20, so the gate is open) and running at the recording's clock, so the snapshot
    takes the recorded fourteen-day window and the resolve maps every name it wrote."""
    universe(conn, ctx)
    schedule(conn, ctx, [2026])
    gate = KickoffGate(PRESEASON_NOW, 2026, first_kickoff_for(conn, 2026))
    run_props_preseason_snapshot(conn, ctx.fetcher, REPLAY_KEY, gate, ctx.now)
    return ()


def _backfill(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """The schedule, then `odds-props-backfill.ts --budget=1 --seasons=2025`."""
    schedule(conn, ctx, [BACKFILL_SEASON])
    season = str(BACKFILL_SEASON)
    return (cli(conn, ctx, ["props-backfill", "--first", season, "--last", season, "--budget", "1"]),)


CASES: tuple[Case, ...] = (
    Case(
        name="odds-snapshot-and-resolve",
        summary="the live props snapshot into player_prop_observations, then every name resolved into props_player_map",
        fixture_sets=("nflverse-universe", "odds-snapshot-2026-10-12"),
        tables=(PLAYERS.as_setup(), PROP_OBSERVATIONS, PROPS_PLAYER_MAP),
        run_python=_snapshot_and_resolve,
        now=NOW,
        recordings=(SNAPSHOT,),
    ),
    Case(
        name="props-preseason-job",
        summary="the props-preseason-snapshot job fired before the opener: the gate, the snapshot, the resolve",
        fixture_sets=("nflverse-universe", "nflverse-schedule", "odds-snapshot-2026-10-12"),
        tables=(PLAYERS.as_setup(), TEAM_WEEK_OBSERVATIONS.as_setup(), PROP_OBSERVATIONS, PROPS_PLAYER_MAP),
        run_python=_preseason_job,
        now=NOW,
    ),
    Case(
        name="odds-backfill",
        summary="odds-props-backfill.ts run as is, one-credit budget, 2025 week 1",
        fixture_sets=("nflverse-schedule", "odds-backfill-2025-week-1"),
        tables=(TEAM_WEEK_OBSERVATIONS.as_setup(), PROP_OBSERVATIONS),
        run_python=_backfill,
        now=datetime(2026, 10, 12, 5, 0, tzinfo=UTC),
        recordings=(BACKFILL,),
        ts_scripts=(Script("research-ts/scripts/odds-props-backfill.ts", ("--budget=1", "--seasons=2025")),),
    ),
)
