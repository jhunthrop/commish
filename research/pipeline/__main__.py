"""THE PIPELINE'S COMMAND LINE: every ingest, against the database in DATABASE_URL, over the live network.

    uv run python -m research.pipeline <ingest> [options]

Each subcommand runs one ingest in one transaction (a failure writes nothing) and prints what it
wrote. Provider keys come from the environment (TANK01_API_KEY, ODDS_API_KEY). The nightly chain
(phase D) calls the same functions; this is the operator's door to them. `coaches --check` and
`win-totals-seed --check` validate the committed seed files and write nothing.
"""

import argparse
import logging
import os
import sys
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import Connection

from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.errors import ConfigurationError
from research.pipeline import crosswalk, vegas
from research.pipeline.budget import FixedBudget
from research.pipeline.coaches import (
    PLAY_CALLERS_CSV_PATH,
    ingest_play_callers_csv,
    parse_play_callers,
    validate_play_callers,
)
from research.pipeline.http import Fetcher, LiveFetcher
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
from research.pipeline.odds import ingest as odds
from research.pipeline.preseason import ingest as preseason
from research.pipeline.tank01 import capture
from research.pipeline.tank01 import ingest as tank01
from research.pipeline.tank01.client import API_KEY_ENV as TANK01_KEY_ENV
from research.pipeline.tank01.client import DEFAULT_SEASON, Tank01Client
from research.pipeline.tank01.provider import Tank01Provider

REPO_ROOT = Path(__file__).resolve().parents[2]
# The provider's daily quota is the operator's ceiling for a hand-run Tank01 ingest.
TANK01_RUN_BUDGET = 1_000

Run = Callable[[Connection, Fetcher, argparse.Namespace], object]


def _key(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value == "":
        raise ConfigurationError(f"{name} is not set.")
    return value


def _now() -> datetime:
    # Millisecond precision, as every stamp the TypeScript wrote carries.
    now = datetime.now(UTC)
    return now.replace(microsecond=now.microsecond // 1000 * 1000)


def _tank01(fetcher: Fetcher, last_week: int | None = None) -> Tank01Provider:
    season = int(os.environ.get("TANK01_SEASON", DEFAULT_SEASON))
    provider = Tank01Provider(Tank01Client(fetcher, _key(TANK01_KEY_ENV)), season=season)
    if last_week is not None:
        provider.last_week_of_season = last_week
    return provider


def _seasons(args: argparse.Namespace) -> list[int]:
    return list(range(args.first, args.last + 1))


def _nflverse_season(conn: Connection, fetcher: Fetcher, args: argparse.Namespace) -> object:
    client = NflverseClient(fetcher)
    universe = ingest.ingest_player_universe(conn, client)
    as_of = ingest.schedule_week_as_of(client, _seasons(args))
    return [ingest.ingest_season(conn, client, universe, s, as_of.get(s)) for s in _seasons(args)]


def _context(conn: Connection, fetcher: Fetcher, args: argparse.Namespace) -> object:
    client = NflverseClient(fetcher)
    seasons = _seasons(args)
    written = ingest_schedule.ingest_schedule(conn, client, seasons)
    for season in seasons:
        context.ingest_play_by_play(conn, client, season)
    context.ingest_coaches(conn, client, seasons)
    context.ingest_opponent_defence(conn, client, seasons)
    injury_reports.ingest_injury_reports(conn, client, seasons)
    injury_archive.ingest_injuries(conn, client, seasons)
    roster_weeks.ingest_roster_weeks(conn, client, seasons)
    return written


def _kdef(conn: Connection, fetcher: Fetcher, args: argparse.Namespace) -> object:
    client = NflverseClient(fetcher)
    crosswalk.seed_team_defense_universe(conn)
    kicking_weeks.ingest_kicking_weeks(conn, client, _seasons(args))
    return team_defense_weeks.ingest_team_defense_weeks(conn, client, _seasons(args), ingest.schedule_client(client))


def _preseason(conn: Connection, fetcher: Fetcher, args: argparse.Namespace) -> object:
    seasons = _seasons(args)
    for season in seasons:
        preseason.ingest_preseason(conn, fetcher, season, _now())
    return seasons


COMMANDS: dict[str, tuple[str, Run]] = {
    "universe": ("the nflverse player universe", lambda c, f, a: ingest.ingest_player_universe(c, NflverseClient(f))),
    "season": ("participation, stat lines and team edges per season (the season-week stats step)", _nflverse_season),
    "context": ("schedule, play-by-play, coaches, opponent adjustment, injuries, rosters", _context),
    "schedule": ("games.csv into team_week_observations", lambda c, f, a: ingest_schedule.ingest_schedule(c, NflverseClient(f), _seasons(a))),
    "derived-stat-lines": ("a gap season's stat lines from play-by-play", lambda c, f, a: [derived_stat_lines.ingest_derived_stat_lines(c, NflverseClient(f), s) for s in _seasons(a)]),
    "draft-picks": ("every NFL draft pick", lambda c, f, a: draft_picks.ingest_draft_picks(c, NflverseClient(f))),
    "kdef": ("the 32 synthetic defenses, kicking weeks, team defense weeks", _kdef),
    "coaches": ("the committed play-caller CSV seed into coaches", lambda c, f, a: ingest_play_callers_csv(c, REPO_ROOT / PLAY_CALLERS_CSV_PATH)),
    "tank01-roster": ("the provider roster and its weekly box scores", lambda c, f, a: tank01.ingest_roster_and_lines(c, _tank01(f, a.last_week), FixedBudget(TANK01_RUN_BUDGET))),
    "tank01-schedule": ("the provider's fixtures into nfl_games", lambda c, f, a: tank01.ingest_schedule(c, _tank01(f), FixedBudget(TANK01_RUN_BUDGET))),
    "tank01-adp": ("the provider's ADP onto players", lambda c, f, a: tank01.ingest_adp(c, _tank01(f), FixedBudget(TANK01_RUN_BUDGET))),
    "headshots": ("the provider's headshot URLs onto players", lambda c, f, a: tank01.backfill_headshots(c, _tank01(f))),
    "crosswalk": ("the provider roster against the universe", lambda c, f, a: crosswalk.build_crosswalk(c, _now())),
    "capture-harvest": ("the capture harvest's five feeds", lambda c, f, a: capture.run_capture_harvest(c, Tank01Client(f, _key(TANK01_KEY_ENV)), _now(), DEFAULT_SEASON)),
    "adp-snapshot": ("the nightly three-format ADP capture", lambda c, f, a: preseason.ingest_adp_snapshot(c, f, _now())),
    "preseason": ("week-one rosters, depth chart and the published boards per season", _preseason),
    "current-ecr": ("the live season's consensus onto the crossed roster", lambda c, f, a: preseason.ingest_current_ecr(c, f, _now())),
    "props-snapshot": ("the fourteen-day props snapshot", lambda c, f, a: odds.run_odds_snapshot(c, f, _key("ODDS_API_KEY"), _now())),
    "props-resolve": ("every observed prop name onto the universe", lambda c, f, a: odds.resolve_all_prop_names(c)),
    "props-backfill": ("the historical props archive, budgeted", lambda c, f, a: odds.backfill_props(c, f, _key("ODDS_API_KEY"), _seasons(a), a.budget)),
    "win-totals-seed": ("the committed win-totals CSV", lambda c, f, a: vegas.ingest_win_totals_csv(c, REPO_ROOT / vegas.WIN_TOTALS_CSV_PATH, _now())),
    "win-totals": ("the publisher's win totals before kickoff", lambda c, f, a: vegas.run_win_totals(c, f, a.last, _now(), preseason.first_kickoff_for(c, a.last))),
}  # fmt: skip


def _check(command: str) -> int:
    if command == "coaches":
        problems = validate_play_callers(parse_play_callers((REPO_ROOT / PLAY_CALLERS_CSV_PATH).read_text()))
    else:
        vegas.win_total_observations(vegas.parse_win_totals_csv((REPO_ROOT / vegas.WIN_TOTALS_CSV_PATH).read_text()))
        problems = []
    for problem in problems:
        sys.stderr.write(problem + "\n")
    return 1 if problems else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research.pipeline", description="Run one research ingest.")
    parser.add_argument("command", choices=sorted(COMMANDS))
    parser.add_argument("--first", type=int, default=DEFAULT_SEASON)
    parser.add_argument("--last", type=int, default=DEFAULT_SEASON)
    parser.add_argument("--last-week", type=int, default=None, help="tank01-roster: stop after this week")
    parser.add_argument("--budget", type=float, default=9000, help="props-backfill: credits this run may spend")
    parser.add_argument(
        "--check", action="store_true", help="coaches, win-totals-seed: validate the seed, write nothing"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    if args.check:
        return _check(args.command)
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        with engine.begin() as conn:
            result = COMMANDS[args.command][1](conn, fetcher, args)
        sys.stdout.write(f"{args.command}: {result}\n")
    finally:
        fetcher.close()
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
