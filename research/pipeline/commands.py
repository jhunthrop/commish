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
from research.pipeline import coaches, crosswalk, history, host_ids, stadiums, vegas
from research.pipeline.budget import FixedBudget
from research.pipeline.checkpoint import Checkpoint
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import (
    context,
    depth_chart_check,
    depth_chart_weeks,
    derived_stat_lines,
    draft_picks,
    games,
    ingest,
    ingest_schedule,
    injury_archive,
    injury_reports,
    kdef_lines,
    kicking_weeks,
    pbp_plays,
    roster_weeks,
    season_stats,
    team_defense_weeks,
    usage_feeds,
)
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nws.client import NwsClient
from research.pipeline.nws.forecast import run_forecast_pass
from research.pipeline.odds import backfill
from research.pipeline.odds import ingest as odds
from research.pipeline.preseason import boards
from research.pipeline.preseason.ingest import first_kickoff_for
from research.pipeline.tank01 import capture, lines, player_clubs
from research.pipeline.tank01 import ingest as tank01
from research.pipeline.tank01.client import API_KEY_ENV as TANK01_KEY_ENV
from research.pipeline.tank01.client import DEFAULT_SEASON, SEASON_ENV, Tank01Client
from research.pipeline.tank01.mapping import WEEKS_LAST
from research.pipeline.tank01.provider import Tank01Provider
from research.pipeline.weather import game_weather, isd

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
    """The universe, then each season's lines and its game results, durable together after each season."""
    client = NflverseClient(inv.fetcher)
    universe = ingest.ingest_player_universe(conn, client)
    inv.checkpoint()
    as_of = ingest.schedule_week_as_of(client, seasons_of(inv.args))
    reports = []
    for season in seasons_of(inv.args):
        reports.append(season_stats.ingest_season_and_results(conn, client, universe, season, as_of.get(season)))
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


def _kdef_lines(conn: Connection, inv: Invocation) -> object:
    """The season-week pass's kicking-defense step for each season: the two weekly tables, then their lines."""
    reports = []
    for season in seasons_of(inv.args):
        refresh = kdef_lines.refresh_kdef_season(conn, NflverseClient(inv.fetcher), season)
        inv.checkpoint()
        reports.append("; ".join((refresh.summary(season), *refresh.detail())))
    return reports


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


def _pbp_plays(conn: Connection, inv: Invocation) -> object:
    """Each season's plays into the play table, durable after each season."""
    client = NflverseClient(inv.fetcher)
    lines = []
    for season in seasons_of(inv.args):
        lines.append(pbp_plays.ingest_pbp_plays(conn, client, season).summary())
        inv.checkpoint()
    return lines


def _depth_chart_weeks(conn: Connection, inv: Invocation) -> object:
    """Each season's weekly depth charts, durable after each season."""
    client = NflverseClient(inv.fetcher)
    lines = []
    for season in seasons_of(inv.args):
        lines.append(depth_chart_weeks.ingest_depth_chart_weeks(conn, client, season).summary())
        inv.checkpoint()
    return lines


# The charted feeds' first published seasons upstream (the data-sources doc): Next Gen Stats weekly
# from 2016, PFR's advanced stats through nflverse from 2018. FTN charting starts in 2022 and is kept
# out of the round 4 fit (no 2021 season), so its history is not ingested here.
NGS_FIRST_SEASON: Final = 2016
PFR_FIRST_SEASON: Final = 2018


def _charted_history(conn: Connection, inv: Invocation) -> object:
    """Next Gen Stats and PFR advanced stats per season through the weekly pass's own ingests
    (`usage_feeds`, Lane 23), durable after each feed."""
    client = NflverseClient(inv.fetcher)
    seasons = seasons_of(inv.args)
    week_as_of = ingest.schedule_week_as_of(client, seasons)
    lines = []
    for season in seasons:
        if season >= NGS_FIRST_SEASON:
            ngs = usage_feeds.ingest_next_gen_stats(conn, client, season, week_as_of.get(season, {}))
            lines.append(f"next-gen-stats {season}: {ngs.summary()}")
            inv.checkpoint()
        if season >= PFR_FIRST_SEASON:
            pfr = usage_feeds.ingest_pfr_advstats(conn, client, season)
            lines.append(f"pfr-advstats {season}: {pfr.summary()}")
            inv.checkpoint()
    return lines


def _game_weather(conn: Connection, inv: Invocation) -> object:
    """The kickoff weather of every regular-season game of the seasons, filled from its three sources."""
    reader = isd.IsdReader(inv.fetcher)
    reports = game_weather.ingest_game_weather(conn, NflverseClient(inv.fetcher), reader, seasons_of(inv.args))
    return [line for report in reports for line in report.lines()] + [f"NCEI reads: {len(reader.requests)}"]


def _win_totals(conn: Connection, inv: Invocation) -> object:
    return vegas.run_win_totals(conn, inv.fetcher, inv.args.last, inv.now, first_kickoff_for(conn, inv.args.last))


def _history(conn: Connection, inv: Invocation) -> object:
    """Every season the fits need, or only `--first`..`--last` when either is given."""
    given = inv.args.first != DEFAULT_SEASON or inv.args.last != DEFAULT_SEASON
    window = range(inv.args.first, inv.args.last + 1) if given else None
    return history.rebuild_history(conn, inv.fetcher, inv.now, inv.checkpoint, window)


def _harvest(conn: Connection, inv: Invocation) -> object:
    client = Tank01Client(inv.fetcher, inv.key(TANK01_KEY_ENV))
    return capture.run_capture_harvest(conn, client, inv.now, inv.tank01_season)


COMMANDS: Final = MappingProxyType({
    "universe": Command("the nflverse player universe", lambda c, i: ingest.ingest_player_universe(c, NflverseClient(i.fetcher))),
    "season": Command("participation, stat lines, team edges and game results per season (the season-week stats step)", _season, atomic=False),
    "context": Command("schedule, play-by-play, coaches, opponent adjustment, injuries, rosters", _context, atomic=False),
    "schedule": Command("games.csv into team_week_observations", lambda c, i: ingest_schedule.ingest_schedule(c, NflverseClient(i.fetcher), seasons_of(i.args))),
    "games": Command("games.csv into nflverse_games, one stamped row per game", lambda c, i: games.ingest_games(c, NflverseClient(i.fetcher), seasons_of(i.args), i.now).line()),
    "stadiums": Command("the reviewed stadium seed into stadiums, validated against nflverse_games", lambda c, i: stadiums.ingest_stadiums(c, RESEARCH_ROOT / stadiums.STADIUMS_CSV_PATH, i.now).line()),
    "lines-backfill": Command("every stored odds capture into the tank01_lines team-week source", lambda c, i: lines.backfill_lines(c).line()),
    "forecast": Command("one pass of the weather service's kickoff forecasts into nws_forecast", lambda c, i: run_forecast_pass(c, NwsClient(i.fetcher), i.now).line()),
    "derived-stat-lines": Command("a gap season's stat lines from play-by-play", _derived, atomic=False),
    "roster-weeks": Command("the weekly roster release archived per season", lambda c, i: roster_weeks.ingest_roster_weeks(c, NflverseClient(i.fetcher), seasons_of(i.args))),
    "draft-picks": Command("every NFL draft pick", lambda c, i: draft_picks.ingest_draft_picks(c, NflverseClient(i.fetcher))),
    "kdef": Command("the 32 synthetic defenses, kicking weeks, team defense weeks", _kdef, atomic=False),
    "kdef-lines": Command("kicking and team defense weeks, then their stat lines (the season-week kicking-defense step)", _kdef_lines, atomic=False),
    "coaches": Command("the committed play-caller seed into coaches", lambda c, i: coaches.ingest_play_callers_csv(c, RESEARCH_ROOT / coaches.PLAY_CALLERS_CSV_PATH)),
    "tank01-roster": Command("the provider roster and its weekly box scores", lambda c, i: tank01.ingest_roster_and_lines(c, tank01_provider(i, i.args.last_week), FixedBudget(TANK01_RUN_BUDGET), i.checkpoint), atomic=False),
    "tank01-schedule": Command("the provider's fixtures into provider_games", lambda c, i: tank01.ingest_schedule(c, tank01_provider(i), FixedBudget(TANK01_RUN_BUDGET))),
    "tank01-adp": Command("the provider's ADP onto provider_players", lambda c, i: tank01.ingest_adp(c, tank01_provider(i), FixedBudget(TANK01_RUN_BUDGET))),
    "headshots": Command("the provider's headshot URLs onto provider_players", lambda c, i: tank01.backfill_headshots(c, tank01_provider(i))),
    "crosswalk": Command("the provider roster against the universe", lambda c, i: crosswalk.build_crosswalk(c, i.now)),
    "provider-names": Command("each crossed provider name as the universe spells it, its diacritics kept (the Lane 78 backfill)", lambda c, i: crosswalk.respell_provider_names(c).line()),
    "host-ids": Command("the fantasy hosts' player ids onto the universe", lambda c, i: host_ids.ingest_host_ids(c, i.fetcher)),
    "capture-harvest": Command("the capture harvest's five feeds", _harvest),
    "player-clubs": Command("the newest stored player list's clubs onto provider_players, the count first (the Lane 122 one-shot; --dry-run writes nothing)", lambda c, i: player_clubs.backfill_player_clubs(c, capture.latest_player_list(c), write=not i.args.dry_run)),
    "adp-snapshot": Command("the nightly three-format ADP capture", lambda c, i: boards.ingest_adp_snapshot(c, i.fetcher, i.now)),
    "preseason": Command("week-one rosters, depth chart and the published boards per season", _preseason, atomic=False),
    "kdef-adp": Command("the kicker and defense ADP rows per season", lambda c, i: [boards.ingest_kdef_adp(c, i.fetcher, s, i.now) for s in seasons_of(i.args)]),
    "current-ecr": Command("the live season's consensus onto the crossed roster", lambda c, i: boards.ingest_current_ecr(c, i.fetcher, i.now)),
    "props-snapshot": Command("the fourteen-day props snapshot", lambda c, i: odds.run_odds_snapshot(c, i.fetcher, i.key(ODDS_KEY_ENV), i.now)),
    "props-resolve": Command("every observed prop name onto the universe", lambda c, i: odds.resolve_all_prop_names(c)),
    "props-backfill": Command("the historical props archive, budgeted", _props_backfill, atomic=False),
    "win-totals-seed": Command("the committed win-totals CSV", lambda c, i: vegas.ingest_win_totals_csv(c, RESEARCH_ROOT / vegas.WIN_TOTALS_CSV_PATH, i.now)),
    "win-totals": Command("the publisher's win totals before kickoff", _win_totals),
    "pbp-plays": Command("the play-level play-by-play per season into nflverse_pbp_plays", _pbp_plays, atomic=False),
    "depth-chart-weeks": Command("nflverse's weekly depth charts per season into nflverse_depth_chart_weeks", _depth_chart_weeks, atomic=False),
    "depth-chart-check": Command("the round 4 depth chart stamp check (reads charts and filings, writes nothing; the coordinator's recorded run)", lambda c, i: depth_chart_check.run_stamp_check(c).lines()),
    "charted-history": Command("Next Gen Stats (2016 on) and PFR advanced stats (2018 on) per season through the weekly pass's ingests", _charted_history, atomic=False),
    "game-weather": Command("the recorded kickoff weather per game into game_weather (games.csv, the gamebook line, NOAA ISD)", _game_weather),
    "history": Command("the seasons the store lost, re-created from nflverse (pipeline/history.py); --first/--last narrow it", _history, atomic=False),
})  # fmt: skip
