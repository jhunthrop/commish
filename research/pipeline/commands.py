"""EVERY INGEST THE COMMAND LINE RUNS, and the transaction each one runs in.

ATOMIC (one transaction, nothing written on failure): every ingest whose TypeScript is a single
write or a few related ones, where all-or-nothing loses nothing and keeps a half-written night
impossible.

NOT ATOMIC, AS THE TYPESCRIPT IS NOT: the provider seed (`seedPlayers`), the historical props
backfill, and the multi-season and multi-step operator ingests (`season`, `preseason`,
`derived-stat-lines`, `context`, `kdef`). Those TypeScript scripts write outside any transaction,
so a stopped run keeps what it wrote and a re-run finishes the rest; each Python port commits at
the same points (`Checkpoint`), so a season-sized seed never holds one transaction open for its
whole duration and a budget stop or a provider failure late in a run does not undo its morning.
"""

import argparse
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from types import MappingProxyType
from typing import Final

from sqlalchemy import Connection

from research.errors import ConfigurationError
from research.pipeline import coaches, crosswalk, history, vegas
from research.pipeline.budget import FixedBudget
from research.pipeline.checkpoint import Checkpoint
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import (
    context,
    derived_stat_lines,
    draft_picks,
    ingest,
    ingest_schedule,
    injury_archive,
    injury_reports,
    kicking_weeks,
    roster_weeks,
    team_defense_weeks,
)
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.odds import backfill
from research.pipeline.odds import ingest as odds
from research.pipeline.preseason import boards
from research.pipeline.preseason.ingest import first_kickoff_for
from research.pipeline.tank01 import capture
from research.pipeline.tank01 import ingest as tank01
from research.pipeline.tank01.client import API_KEY_ENV as TANK01_KEY_ENV
from research.pipeline.tank01.client import DEFAULT_SEASON, SEASON_ENV, Tank01Client
from research.pipeline.tank01.mapping import WEEKS_LAST
from research.pipeline.tank01.provider import Tank01Provider

RESEARCH_ROOT: Final = Path(__file__).resolve().parents[1]
ODDS_KEY_ENV: Final = "ODDS_API_KEY"
# The provider's daily quota is the operator's ceiling for one hand-run Tank01 ingest.
TANK01_RUN_BUDGET: Final = 1_000


@dataclass(frozen=True)
class Invocation:
    """Everything a command reads from outside the database, handed in: the network, the
    operator's arguments, the durability callback, the instant it treats as now, and the
    environment it reads provider keys and the provider season from."""

    fetcher: Fetcher
    args: argparse.Namespace
    checkpoint: Checkpoint
    now: datetime
    environ: Mapping[str, str]

    def key(self, name: str) -> str:
        value = self.environ.get(name, "").strip()
        if value == "":
            raise ConfigurationError(f"{name} is not set.")
        return value

    @property
    def tank01_season(self) -> int:
        return int(self.environ.get(SEASON_ENV, DEFAULT_SEASON))


Run = Callable[[Connection, Invocation], object]


@dataclass(frozen=True)
class Command:
    description: str
    run: Run
    atomic: bool = True


def now_ms() -> datetime:
    """The wall clock at millisecond precision, as every stamp the TypeScript writes."""
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def seasons_of(args: argparse.Namespace) -> list[int]:
    return list(range(args.first, args.last + 1))


def tank01_provider(inv: Invocation, last_week: int | None = None) -> Tank01Provider:
    client = Tank01Client(inv.fetcher, inv.key(TANK01_KEY_ENV))
    weeks = WEEKS_LAST if last_week is None else last_week
    return Tank01Provider(client, season=inv.tank01_season, last_week_of_season=weeks)


def _season(conn: Connection, inv: Invocation) -> object:
    client = NflverseClient(inv.fetcher)
    universe = ingest.ingest_player_universe(conn, client)
    inv.checkpoint()
    as_of = ingest.schedule_week_as_of(client, seasons_of(inv.args))
    reports = []
    for season in seasons_of(inv.args):
        reports.append(ingest.ingest_season(conn, client, universe, season, as_of.get(season)))
        inv.checkpoint()
    return reports


def _context(conn: Connection, inv: Invocation) -> object:
    """`projection-context.ts`'s sequence, durable after each step as the script's writes are."""
    client = NflverseClient(inv.fetcher)
    seasons = seasons_of(inv.args)
    ingest_schedule.ingest_schedule(conn, client, seasons)
    inv.checkpoint()
    for season in seasons:
        context.ingest_play_by_play(conn, client, season)
        inv.checkpoint()
    for step in (context.ingest_coaches, context.ingest_opponent_defence, injury_reports.ingest_injury_reports):
        step(conn, client, seasons)
        inv.checkpoint()
    injury_archive.ingest_injuries(conn, client, seasons)
    inv.checkpoint()
    return roster_weeks.ingest_roster_weeks(conn, client, seasons)


def _kdef(conn: Connection, inv: Invocation) -> object:
    client = NflverseClient(inv.fetcher)
    crosswalk.seed_team_defense_universe(conn)
    kicking_weeks.ingest_kicking_weeks(conn, client, seasons_of(inv.args))
    inv.checkpoint()
    return team_defense_weeks.ingest_team_defense_weeks(
        conn, client, seasons_of(inv.args), ingest.schedule_client(client)
    )


def _derived(conn: Connection, inv: Invocation) -> object:
    reports = []
    for season in seasons_of(inv.args):
        reports.append(derived_stat_lines.ingest_derived_stat_lines(conn, NflverseClient(inv.fetcher), season))
        inv.checkpoint()
    return reports


def _preseason(conn: Connection, inv: Invocation) -> object:
    report = boards.BoardsReport()
    for season in seasons_of(inv.args):
        report = report.merged(boards.ingest_preseason(conn, inv.fetcher, season, inv.now))
        inv.checkpoint()
    return report


def _props_backfill(conn: Connection, inv: Invocation) -> object:
    request = backfill.BackfillRequest(inv.key(ODDS_KEY_ENV), tuple(seasons_of(inv.args)), inv.args.budget)
    return backfill.backfill_props(conn, inv.fetcher, request, inv.checkpoint)


def _win_totals(conn: Connection, inv: Invocation) -> object:
    return vegas.run_win_totals(conn, inv.fetcher, inv.args.last, inv.now, first_kickoff_for(conn, inv.args.last))


def _harvest(conn: Connection, inv: Invocation) -> object:
    client = Tank01Client(inv.fetcher, inv.key(TANK01_KEY_ENV))
    return capture.run_capture_harvest(conn, client, inv.now, inv.tank01_season)


COMMANDS: Final = MappingProxyType({
    "universe": Command("the nflverse player universe", lambda c, i: ingest.ingest_player_universe(c, NflverseClient(i.fetcher))),
    "season": Command("participation, stat lines and team edges per season (the season-week stats step)", _season, atomic=False),
    "context": Command("schedule, play-by-play, coaches, opponent adjustment, injuries, rosters", _context, atomic=False),
    "schedule": Command("games.csv into team_week_observations", lambda c, i: ingest_schedule.ingest_schedule(c, NflverseClient(i.fetcher), seasons_of(i.args))),
    "derived-stat-lines": Command("a gap season's stat lines from play-by-play", _derived, atomic=False),
    "roster-weeks": Command("the weekly roster release archived per season", lambda c, i: roster_weeks.ingest_roster_weeks(c, NflverseClient(i.fetcher), seasons_of(i.args))),
    "draft-picks": Command("every NFL draft pick", lambda c, i: draft_picks.ingest_draft_picks(c, NflverseClient(i.fetcher))),
    "kdef": Command("the 32 synthetic defenses, kicking weeks, team defense weeks", _kdef, atomic=False),
    "coaches": Command("the committed play-caller seed into coaches", lambda c, i: coaches.ingest_play_callers_csv(c, RESEARCH_ROOT / coaches.PLAY_CALLERS_CSV_PATH)),
    "tank01-roster": Command("the provider roster and its weekly box scores", lambda c, i: tank01.ingest_roster_and_lines(c, tank01_provider(i, i.args.last_week), FixedBudget(TANK01_RUN_BUDGET), i.checkpoint), atomic=False),
    "tank01-schedule": Command("the provider's fixtures into provider_games", lambda c, i: tank01.ingest_schedule(c, tank01_provider(i), FixedBudget(TANK01_RUN_BUDGET))),
    "tank01-adp": Command("the provider's ADP onto provider_players", lambda c, i: tank01.ingest_adp(c, tank01_provider(i), FixedBudget(TANK01_RUN_BUDGET))),
    "headshots": Command("the provider's headshot URLs onto provider_players", lambda c, i: tank01.backfill_headshots(c, tank01_provider(i))),
    "crosswalk": Command("the provider roster against the universe", lambda c, i: crosswalk.build_crosswalk(c, i.now)),
    "capture-harvest": Command("the capture harvest's five feeds", _harvest),
    "adp-snapshot": Command("the nightly three-format ADP capture", lambda c, i: boards.ingest_adp_snapshot(c, i.fetcher, i.now)),
    "preseason": Command("week-one rosters, depth chart and the published boards per season", _preseason, atomic=False),
    "kdef-adp": Command("the kicker and defense ADP rows per season", lambda c, i: [boards.ingest_kdef_adp(c, i.fetcher, s, i.now) for s in seasons_of(i.args)]),
    "current-ecr": Command("the live season's consensus onto the crossed roster", lambda c, i: boards.ingest_current_ecr(c, i.fetcher, i.now)),
    "props-snapshot": Command("the fourteen-day props snapshot", lambda c, i: odds.run_odds_snapshot(c, i.fetcher, i.key(ODDS_KEY_ENV), i.now)),
    "props-resolve": Command("every observed prop name onto the universe", lambda c, i: odds.resolve_all_prop_names(c)),
    "props-backfill": Command("the historical props archive, budgeted", _props_backfill, atomic=False),
    "win-totals-seed": Command("the committed win-totals CSV", lambda c, i: vegas.ingest_win_totals_csv(c, RESEARCH_ROOT / vegas.WIN_TOTALS_CSV_PATH, i.now)),
    "win-totals": Command("the publisher's win totals before kickoff", _win_totals),
    "history": Command("the seasons the store lost, re-created from nflverse (pipeline/history.py)", lambda c, i: history.rebuild_history(c, i.fetcher, i.now, i.checkpoint), atomic=False),
})  # fmt: skip
