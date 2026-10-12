"""The props cases: the live snapshot with its name resolution, and the historical backfill run as
the operator runs it (`scripts/odds-props-backfill.ts --budget=1 --seasons=2025`, unmodified)."""

import json
import os
from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection

from research.errors import ConfigurationError
from research.parity.case import Case, Recording, RunContext
from research.parity.cases.nflverse_season import NOW
from research.parity.cases.tables import NFL_PLAYERS, PROPS_PLAYER_MAP, TEAM_WEEK_OBSERVATIONS
from research.parity.diff import TableSpec
from research.parity.record import RecordSpec
from research.parity.replay import FIXTURES_ROOT, ReplayFetcher
from research.pipeline.http import Fetcher
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.ingest import ingest_player_universe
from research.pipeline.nflverse.ingest_schedule import ingest_schedule
from research.pipeline.nflverse.schedule import ScheduleMetric, map_schedule, schedule_observations
from research.pipeline.odds.ingest import (
    _ODDS_PARAMS,
    _SNAPSHOT_OFFSET_HOURS,
    _WEEK_WINDOW_DAYS,
    backfill_props,
    resolve_all_prop_names,
    run_odds_snapshot,
    select_upcoming_events,
    to_historical_date_param,
)
from research.pipeline.odds.props import API_KEY_ENV, SPORT_KEY, odds_url, parse_odds_event

REPLAY_KEY = "replay"
BACKFILL_SEASON = 2025
PROP_OBSERVATIONS = TableSpec(
    "player_prop_observations",
    ("event_id", "bookmaker", "market", "player_name", "point", "fetched_at"),
    unique=False,
)


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
        url = odds_url(f"/sports/{SPORT_KEY}/events/{event.id}/odds", key, _ODDS_PARAMS)
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
    date = to_historical_date_param(kickoff - timedelta(hours=_SNAPSHOT_OFFSET_HOURS))
    events_url = odds_url(f"/historical/sports/{SPORT_KEY}/events", key, {"date": date})
    page = json.loads(fetcher.get(events_url).text())
    events = [parse_odds_event(raw, "data") for raw in page["data"]]
    window_end = kickoff + timedelta(days=_WEEK_WINDOW_DAYS)
    first = next(e for e in events if kickoff <= e.commence_time < window_end)
    odds = odds_url(f"/historical/sports/{SPORT_KEY}/events/{first.id}/odds", key, {"date": date, **_ODDS_PARAMS})
    return [
        RecordSpec(url=events_url, file="historical_events_week_1.json.gz"),
        RecordSpec(url=odds, file=f"historical_event_odds_{first.id}.json.gz"),
    ]


SNAPSHOT = Recording(
    fixture_set="odds-snapshot-2026-10-12",
    specs=_snapshot_specs,
    note="The Odds API, recorded 2026-10-12: the NFL events list and the five prop markets for every event the "
    "snapshot selects (kicking off within fourteen days of 05:00 UTC, earliest first, at most twenty). The key is "
    "stripped from every recorded URL.",
)
BACKFILL = Recording(
    fixture_set="odds-backfill-2025-week-1",
    specs=_backfill_specs,
    note="The Odds API's historical archive at eight hours before 2025's first kickoff: the events page and the "
    "first in-window event's five prop markets, which is exactly what a run with a budget of one credit reads.",
)


def _snapshot_and_resolve(conn: Connection, ctx: RunContext) -> None:
    ingest_player_universe(conn, NflverseClient(ctx.fetcher))
    run_odds_snapshot(conn, ctx.fetcher, REPLAY_KEY, ctx.now)
    resolve_all_prop_names(conn)


def _backfill(conn: Connection, ctx: RunContext) -> None:
    ingest_schedule(conn, NflverseClient(ctx.fetcher), [BACKFILL_SEASON])
    backfill_props(conn, ctx.fetcher, REPLAY_KEY, [BACKFILL_SEASON], budget=1)


CASES: tuple[Case, ...] = (
    Case(
        name="odds-snapshot-and-resolve",
        summary="the live props snapshot into player_prop_observations, then every name resolved into props_player_map",
        fixture_sets=("nflverse-universe", "odds-snapshot-2026-10-12"),
        tables=(NFL_PLAYERS, PROP_OBSERVATIONS, PROPS_PLAYER_MAP),
        run_python=_snapshot_and_resolve,
        now=NOW,
        recordings=(SNAPSHOT,),
    ),
    Case(
        name="odds-backfill",
        summary="scripts/odds-props-backfill.ts run unmodified, one-credit budget, 2025 week 1",
        fixture_sets=("nflverse-schedule", "odds-backfill-2025-week-1"),
        tables=(TEAM_WEEK_OBSERVATIONS, PROP_OBSERVATIONS),
        run_python=_backfill,
        now=datetime(2026, 10, 12, 5, 0, tzinfo=UTC),
        recordings=(BACKFILL,),
        ts_scripts=(("scripts/odds-props-backfill.ts", "--budget=1", "--seasons=2025"),),
    ),
)
