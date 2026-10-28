"""`python -m research.inseason --task <task>`: one pass of an in-season job (the Cloud Run Job `inseason`).

    uv run python -m research.inseason --task season-week [--season 2026] [--skip props-snapshot]
    uv run python -m research.inseason --task usage-backfill [--season 2026]
    uv run python -m research.inseason --task capture-harvest
    uv run python -m research.inseason --task capture-status
    uv run python -m research.inseason void-game --season S --week W --game ID --reason TEXT --by WHO [--lift]

`void-game` is the operator's void of one game of the game table, so a game cancelled or dropped from
games.csv never blocks its week's grade (Lane 249, B255, `inseason/game_voids.py`): checked against the
week's games, one append-only row, one line saying what it did. Never scheduled; with gcloud lapsed,
`ops.yml` runs it on the `inseason` job.

`capture-harvest` takes the hourly provider capture, dates the newest injury capture for the API into
`app.designation_datings` (Lane 134, `nightly/designation_dating.py`) in the capture's transaction, in a
savepoint (Lane 141, B116); a connection lost in that transaction writes the capture again, once, undated, on
a fresh connection from the answers already read (Lane 143, B125), then reads the hour's game figures from it into
`tank01_lines` and the weather service's kickoff forecasts into `nws_forecast` (Lane 66a). While a game
of the current week that kicked off has no final, up to four days past its kickoff (Lane 84), it asks
Tank01's week of games once for their statuses (Lane 80, `pipeline/tank01/game_status.py`, at most two
calls an hour), and a game that answer still has open, or leaves out, 3 h 30 m past its kickoff by its own box score
(Lane 101, at most two a pass), so a game is final the hour after it ends. Then, once an Eastern day from
06:00, and again from 09:00 on a game day of the current week (Lane 160, B138), on what the pass left of
its ten requests, the player list (Lane 110, B79), the one feed carrying
each injured player's expected return (`injReturnDate`), which the API reads beside his designation; the
same read writes each listed player's club onto `provider_players` and names how many changed (Lane 122,
`pipeline/tank01/player_clubs.py`), and a read that would change more than 60 writes none and fails.

`capture-status` is the game-day status pass (Lane 263), every 15 minutes in the game-day windows: the injury
designations and the inactives alone (two requests, `pipeline/tank01/capture.py` `run_capture_status`), the
newest injury capture dated for the API in the same transaction, then the hourly week-ahead reads pass, so a
status move found at :15 rewrites that player's read within the hourly dollar budgets. No game figures,
statuses, player list, projections or market: the hourly harvest keeps those.

`usage-backfill` runs the weekly pass's usage steps alone (play-by-play and the three charted feeds)
for every week nflverse has published: the operator's one-shot for weeks played before the steps
existed. Idempotent (a re-run writes nothing new), no register trail, each feed's counts printed.

`capture-harvest` also takes the week ahead's Tank01 projection once a day, on the first pass at or
after 06:00 Eastern from the day after the previous week's last kickoff until the week's first
(Lane 97, `pipeline/tank01/projections.py` `daily_capture_due`), and, in a kickoff slot's window, the
slot week's projection, the anytime-touchdown market (the weekly round 4's two benchmarks, `pipeline/kickoff_slots.py`) and the
season's dated depth charts again. Last, after the status capture, the hourly week-ahead reads pass
(Lane 72, `nightly/week_reads.py`): the reads whose status the hour moved (a projection move is the nightly's),
under the hourly dollar budget; advisory, its own line, never the job's verdict.

Exit status 1 when any step failed (or the capture was refused), 0 otherwise. Provider keys come
from the environment: TANK01_API_KEY for the capture, ODDS_API_KEY for the props snapshot and the
touchdown market (absent, the market is skipped with a line).
"""

import argparse
import logging
import os
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Final

import httpx
from psycopg.errors import InsufficientPrivilege
from sqlalchemy import Connection, Engine
from sqlalchemy.exc import SQLAlchemyError

from research.cli import log_line as _line
from research.db.engine import make_engine
from research.db.url import database_url_from_env
from research.errors import ResearchError
from research.inseason import usage_steps
from research.inseason.game_voids import VOID_COMMAND, VoidRequest, record_void
from research.inseason.season_of import (
    calendar_season,
    out_of_window_reason,
    placed_season,
    season_spans,
    stored_span,
    unplaced_reason,
)
from research.inseason.season_week import STEPS, SeasonWeekContext, run_season_week, run_usage_backfill
from research.inseason.step_result import StepResult
from research.logging_setup import configure_logging
from research.nightly.capsule_step import night_facts
from research.nightly.designation_dating import date_newest_capture
from research.nightly.publish import take_run_id
from research.nightly.published_board import driver_line
from research.nightly.r2 import run_store
from research.nightly.register_log import WEEKLY_SUFFIX, record_freeze, record_pass
from research.nightly.week_reads import run_week_read_step
from research.pipeline.budget import FixedBudget
from research.pipeline.commands import ODDS_KEY_ENV, now_ms
from research.pipeline.http import Fetcher, LiveFetcher
from research.pipeline.kickoff_slots import due_slot, kickoff_slots
from research.pipeline.kickoffs import stored_kickoffs
from research.pipeline.nws.client import NwsClient
from research.pipeline.nws.forecast import FORECAST_SOURCE, run_forecast_pass
from research.pipeline.odds.touchdowns import run_td_snapshot
from research.pipeline.recording_fetcher import RecordingFetcher
from research.pipeline.tank01.capture import (
    CAPTURE_HARVEST_REQUEST_BUDGET,
    CaptureResult,
    capture_return_dates,
    run_capture_harvest,
    run_capture_status,
)
from research.pipeline.tank01.client import API_KEY_ENV, DEFAULT_SEASON, SEASON_ENV, Tank01Client
from research.pipeline.tank01.game_status import STATUS_SOURCE, capture_game_status
from research.pipeline.tank01.lines import LINES_SOURCE, lines_after_harvest
from research.pipeline.tank01.projections import parse_stored_projections

TASKS: Final = ("season-week", "usage-backfill", "capture-harvest", "capture-status")
CONNECTION_LOST_LINE: Final = (
    "the connection was lost before the capture committed; the capture committed again on a new connection, "
    "undated (the API dates it itself)"
)
LOG: Final = logging.getLogger(__name__)


def _season_week(args: argparse.Namespace, now: datetime) -> bool:
    skip = frozenset(step for step in args.skip.split(",") if step)
    unknown = skip - set(STEPS)
    if unknown:
        raise SystemExit(f"inseason: no step {', '.join(sorted(unknown))}; steps are {', '.join(STEPS)}")
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    freezes: list[tuple[int, datetime]] = []
    try:
        season = _season(engine, args.season, now)
        if isinstance(season, StepResult):
            results = [season]
        else:
            context = SeasonWeekContext(
                engine, fetcher, now, season, os.environ, skip, lambda week, at: freezes.append((week, at))
            )
            results = run_season_week(context)
    finally:
        fetcher.close()
        engine.dispose()
    # The freezes are in the database already; the bucket's trail comes after, and its failure is its
    # own failed line (fix round 2, N2): an R2 outage or a bad token never costs a freeze.
    results.append(_trail(args.out, now, None if isinstance(season, StepResult) else season, freezes, results))
    _line(f"season-week pass, season {season if isinstance(season, int) else 'unplaced'}")
    for result in results:
        _line(f"{result.step}: {result.status}, {result.summary}")
        for detail in result.detail:
            _line(f"  {detail}")
    return all(result.status != "failed" for result in results)


def _usage_backfill(args: argparse.Namespace, now: datetime) -> bool:
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        season = _season(engine, args.season, now)
        results = (
            [season]
            if isinstance(season, StepResult)
            else run_usage_backfill(SeasonWeekContext(engine, fetcher, now, season, os.environ))
        )
    finally:
        fetcher.close()
        engine.dispose()
    _line(f"usage-backfill, season {season if isinstance(season, int) else 'unplaced'}")
    for result in results:
        _line(f"{result.step}: {result.status}, {result.summary}")
        for detail in result.detail:
            _line(f"  {detail}")
    return all(result.status != "failed" for result in results)


def _season(engine: Engine, given: int | None, now: datetime) -> int | StepResult:
    """The season the pass works on: `--season`, else the one the stored schedule places today."""
    if given is not None:
        return given
    with engine.connect() as conn:
        spans = season_spans(conn)
    placed = placed_season(spans, now)
    if placed is not None:
        return placed
    # Outside the calendar season's window is no pass to make (review R1); a calendar season with no
    # stored schedule is the failure N3 exists for.
    span = stored_span(spans, calendar_season(now))
    if span is not None:
        return StepResult("season", "skipped", out_of_window_reason(span, now))
    return StepResult("season", "failed", unplaced_reason(spans, now))


def _trail(
    out: str | None,
    now: datetime,
    season: int | None,
    freezes: Sequence[tuple[int, datetime]],
    results: Sequence[StepResult],
) -> StepResult:
    """The register's trail in the bucket: the pass's run id, each freeze it took, and its lines."""
    lines = [{"step": r.step, "status": r.status, "summary": r.summary, "detail": list(r.detail)} for r in results]
    try:
        with httpx.Client(timeout=60.0) as http:
            store = run_store(out, http)
            run_id = take_run_id(store, now, WEEKLY_SUFFIX)
            for week, at in freezes:
                if season is not None:
                    record_freeze(store, season, week, run_id, at)
            record_pass(store, run_id, now, lines)
    # Any failure here is reported as the trail's own line, never raised past the freezes.
    except Exception as error:
        LOG.exception("season-week trail failed")
        return StepResult("trail", "failed", f"the register's trail was not written ({error}); every freeze stands")
    return StepResult("trail", "ok", f"pass {run_id}, {len(freezes)} freezes recorded")


def _game_facts(engine: Engine, fetcher: LiveFetcher, harvest: CaptureResult, now: datetime) -> bool:
    """The hour's game figures from the capture just taken, then the forecasts, each in its own
    transaction so one failing keeps the other and the capture (Lane 66a)."""
    ok = True
    try:
        with engine.begin() as conn:
            lines = lines_after_harvest(conn, harvest, now)
        _line(f"  {LINES_SOURCE}: " + ("the odds feed was not read" if lines is None else lines.line()))
    except Exception as error:
        LOG.exception("the lines parse failed")
        _line(f"  {LINES_SOURCE}: FAILED, {error}")
        ok = False
    try:
        with engine.begin() as conn:
            forecast = run_forecast_pass(conn, NwsClient(fetcher), now)
        _line(f"  {FORECAST_SOURCE}: {forecast.line()}")
        ok = ok and not forecast.failed
    except Exception as error:
        LOG.exception("the forecast pass failed")
        _line(f"  {FORECAST_SOURCE}: FAILED, {error}")
        ok = False
    return ok


def _capture_harvest(now: datetime) -> bool:
    key = os.environ.get(API_KEY_ENV, "").strip()
    if not key:
        _line(f"capture-harvest: REFUSED, {API_KEY_ENV} is not set")
        return False
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    season = int(os.environ.get(SEASON_ENV, DEFAULT_SEASON))
    answers = RecordingFetcher(fetcher)
    try:
        result, dated_ok = _capture_dated(
            engine,
            lambda conn, read: run_capture_harvest(conn, Tank01Client(read, key), now, season),
            answers,
            now,
        )
        facts_ok = _game_facts(engine, fetcher, result, now)
        # On what the harvest left of its request budget this pass (Lane 80).
        left = requests_left(answers)
        status = _game_status(engine, Tank01Client(fetcher, key), now, season, FixedBudget(left))
        # Last, on what the status left: the day's player list, for the return dates (Lane 110, B79).
        returns_ok = _return_dates(engine, Tank01Client(fetcher, key), now, season, FixedBudget(left - status.requests))
    finally:
        fetcher.close()
        engine.dispose()
    for feed in result.feeds:
        reason = "" if feed.reason is None else f", {feed.reason}"
        _line(f"  {feed.source}: {feed.status}, {feed.requests} requests{reason}")
    if result.reason is not None:
        _line(f"capture-harvest: REFUSED, {result.reason}")
        return False
    failed = [feed.source for feed in result.feeds if feed.status == "failed"]
    _line(f"capture-harvest: {len(result.feeds)} feeds, {len(failed)} failed")
    parsed = _parse_projections()
    # The market is its own provider and its own line: a failed Tank01 feed never skips it.
    market = _touchdown_market(now, season)
    charts = _slot_depth_charts(now, season)
    _week_reads(now)
    return not failed and dated_ok and facts_ok and status.ok and returns_ok and parsed and market and charts


def _capture_status(now: datetime) -> bool:
    """The game-day status pass (Lane 263): the status feeds captured and dated, then the week reads."""
    key = os.environ.get(API_KEY_ENV, "").strip()
    if not key:
        _line(f"capture-status: REFUSED, {API_KEY_ENV} is not set")
        return False
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    season = int(os.environ.get(SEASON_ENV, DEFAULT_SEASON))
    try:
        result, dated_ok = _capture_dated(
            engine,
            lambda conn, read: run_capture_status(conn, Tank01Client(read, key), now, season),
            RecordingFetcher(fetcher),
            now,
        )
    finally:
        fetcher.close()
        engine.dispose()
    for feed in result.feeds:
        reason = "" if feed.reason is None else f", {feed.reason}"
        _line(f"  {feed.source}: {feed.status}, {feed.requests} requests{reason}")
    if result.reason is not None:
        _line(f"capture-status: REFUSED, {result.reason}")
        return False
    failed = [feed.source for feed in result.feeds if feed.status == "failed"]
    _line(f"capture-status: {len(result.feeds)} feeds, {len(failed)} failed")
    _week_reads(now)
    return not failed and dated_ok


def requests_left(answers: RecordingFetcher) -> int:
    """The pass's requests left after the capture: the ceiling less what the provider was really asked
    (Lane 143 fix round 1). Never the feeds' own count: a retry after a commit that landed (only its
    acknowledgement lost) chooses its feeds again and drops one the provider already served."""
    return CAPTURE_HARVEST_REQUEST_BUDGET - answers.asked


def _capture_dated(
    engine: Engine, capture: Callable[[Connection, Fetcher], CaptureResult], answers: RecordingFetcher, now: datetime
) -> tuple[CaptureResult, bool]:
    """The capture and its dating in one transaction: the dating commits with the capture it dates, so no
    API instance sees the capture undated and dates it itself (Lane 141, B116), and its savepoint keeps the
    capture from a refused dating. A savepoint can not keep it from a dead connection (Lane 143, B125): the
    transaction is lost with it, so the capture is written again, once, on a fresh connection and without
    its dating (the API dates the capture itself), from the answers the first attempt kept, never asking
    the provider twice. The dating's failure is its own line; a second loss fails the job."""
    dated_ok = True
    with engine.connect() as conn:
        try:
            with conn.begin():
                result = capture(conn, answers)
                dated_ok = _date_designations(conn, now)
            return result, dated_ok
        except SQLAlchemyError:
            if not conn.invalidated:
                raise
            LOG.exception("the capture's transaction was lost with its connection")
    _line(f"capture-harvest: {CONNECTION_LOST_LINE}")
    with engine.begin() as conn:
        return capture(conn, answers.replay()), dated_ok


def _date_designations(conn: Connection, now: datetime) -> bool:
    """Right after the capture, in its transaction, the newest injury capture dated for the API (Lane 134,
    `nightly/designation_dating.py`): the two commit together, so no API instance dates the capture
    itself between them (Lane 141, B116), and the dating runs in a savepoint, so a refused or failed
    dating rolls back only itself and the capture commits. Any failure is its own line and the hour goes
    on (the API dates the capture itself meanwhile, as before); only a missing grant fails the job, since
    it fails every hour until an operator grants it."""
    try:
        with conn.begin_nested():
            outcome = date_newest_capture(conn, now)
    except SQLAlchemyError as error:
        LOG.exception("the designation dating failed")
        denied = isinstance(getattr(error, "orig", None), InsufficientPrivilege)
        _line(f"  designation-dating: FAILED, {driver_line(error)}; the API dates the capture itself")
        return not denied
    # An aid to the API, never the hour's verdict; named, not swallowed.
    except Exception as error:
        LOG.exception("the designation dating failed")
        _line(f"  designation-dating: FAILED, {type(error).__name__}: {error}; the API dates the capture itself")
        return True
    _line(f"  {outcome.line}")
    return True


@dataclass(frozen=True)
class _Status:
    """The status step's verdict and the requests it made (the player list takes what is left)."""

    ok: bool
    requests: int


def _game_status(engine: Engine, client: Tank01Client, now: datetime, season: int, budget: FixedBudget) -> _Status:
    """The games' statuses (Lane 80), in a transaction of their own so a refused read never rolls back
    the capture: its line names its requests, and a refusal by the hourly cap is not a failure. A
    lagging game's refused or failed box score (Lane 101) fails the line; the week's read stands. A
    provider failure is counted as the week's one request, so the player list never spends it again."""
    try:
        with engine.begin() as conn:
            status = capture_game_status(conn, client, season, now, budget)
    except (ResearchError, httpx.HTTPError) as error:
        _line(f"  {STATUS_SOURCE}: FAILED, {error}")
        return _Status(False, min(budget.limit, 1))
    _line(f"  {STATUS_SOURCE}: {status.line}")
    return _Status(not status.failed, status.requests)


def _return_dates(engine: Engine, client: Tank01Client, now: datetime, season: int, budget: FixedBudget) -> bool:
    """The day's player list (Lane 110, B79) and its clubs (Lane 122) in a transaction of its own: its line
    when due, with the clubs it changed, a failure or a refused club write failing the job (the next hour
    asks again), a pass with no request left only named."""
    with engine.begin() as conn:
        outcome = capture_return_dates(conn, client, now, season, budget)
    if outcome is None:
        return True
    reason = "" if outcome.reason is None else f", {outcome.reason}"
    note = "" if outcome.note is None else f", {outcome.note}"
    _line(f"  {outcome.source}: {outcome.status}, {outcome.requests} requests{reason}{note}")
    return outcome.status != "failed"


def _week_reads(now: datetime) -> None:
    """The hourly week-ahead reads pass after the status capture: its line, a failure named and never the
    job's verdict (the nightly's step is advisory the same way)."""
    engine = make_engine(database_url_from_env())
    try:
        record = run_week_read_step(engine, now, _line, night_facts(engine), hourly=True)
        _line(f"{record.name}: {record.status}, {record.summary}")
    except Exception as error:  # an aid to the page, never the capture's verdict; named, not swallowed
        _line(f"week-reads: FAILED, {type(error).__name__}: {error}")
    finally:
        engine.dispose()


def _slot_depth_charts(now: datetime, season: int) -> bool:
    """In a kickoff slot's window, the season's dated depth charts again (`usage_steps.depth_charts`),
    so the slot's games read a snapshot loaded that day; its own line."""
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        with engine.connect() as conn:
            slot = due_slot(kickoff_slots(stored_kickoffs(conn, season)), now)
        if slot is None:
            _line("depth-charts: no kickoff slot due")
            return True
        result = usage_steps.depth_charts(engine, fetcher, season)
    except (ResearchError, httpx.HTTPError) as error:
        _line(f"depth-charts: FAILED, {error}")
        return False
    finally:
        fetcher.close()
        engine.dispose()
    _line(f"depth-charts, week {slot.week} {slot.name}: {result.status}, {result.summary}")
    return result.status != "failed"


def _parse_projections() -> bool:
    """The stored projections parsed in a transaction after the capture's, so a refused snapshot is its
    own failed line and the capture stands."""
    engine = make_engine(database_url_from_env())
    try:
        with engine.begin() as conn:
            report = parse_stored_projections(conn)
    finally:
        engine.dispose()
    _line(report.line())
    return not report.refused


def _touchdown_market(now: datetime, season: int) -> bool:
    """The anytime-touchdown benchmark in a kickoff slot's window (`odds.touchdowns`); its own line."""
    key = os.environ.get(ODDS_KEY_ENV, "").strip()
    if not key:
        _line(f"anytime-touchdown market: skipped, {ODDS_KEY_ENV} is not set")
        return True
    engine = make_engine(database_url_from_env())
    fetcher = LiveFetcher()
    try:
        with engine.begin() as conn:
            snapshot = run_td_snapshot(conn, fetcher, key, season, now)
    except (ResearchError, httpx.HTTPError) as error:
        _line(f"anytime-touchdown market: FAILED, {error}")
        return False
    finally:
        fetcher.close()
        engine.dispose()
    _line(snapshot.line())
    return True


def _void_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog=f"research.inseason {VOID_COMMAND}", description="void one game of the game table, or lift its void"
    )
    parser.add_argument("--season", type=int, required=True)
    parser.add_argument("--week", type=int, required=True)
    parser.add_argument("--game", required=True, help="the nflverse game id, as nflverse_games holds it")
    parser.add_argument("--reason", required=True, help="why, in a few words")
    parser.add_argument("--by", required=True, help="who voids it")
    parser.add_argument("--lift", action="store_true", help="lift the game's standing void instead")
    return parser


def void_game(argv: Sequence[str], now: datetime) -> int:
    """One void or lift written and its line printed; a refusal is its own line and exit status 1."""
    args = _void_parser().parse_args(argv)
    request = VoidRequest(args.season, args.week, args.game, args.reason, args.by, args.lift)
    engine = make_engine(database_url_from_env())
    try:
        with engine.begin() as conn:
            line = record_void(conn, request, now)
    except ResearchError as error:
        _line(f"{VOID_COMMAND}: REFUSED, {error}")
        return 1
    except SQLAlchemyError as error:
        # The transaction rolled back: one line naming the error's class, never a traceback.
        _line(f"{VOID_COMMAND}: REFUSED, the database answered {type(error).__name__}; nothing written.")
        return 1
    finally:
        engine.dispose()
    _line(line)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    given = list(sys.argv[1:] if argv is None else argv)
    if given[:1] == [VOID_COMMAND]:
        configure_logging(logging.INFO)
        return void_game(given[1:], now_ms())
    parser = argparse.ArgumentParser(prog="research.inseason", description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--task", required=True, choices=TASKS)
    parser.add_argument(
        "--season",
        type=int,
        default=None,
        help="season-week, usage-backfill: the season (default: the one the stored schedule places today)",
    )
    parser.add_argument("--skip", default="", help=f"season-week: steps to skip, of {', '.join(STEPS)}")
    parser.add_argument("--out", default=None, help="season-week: a local directory for the register's trail, not R2")
    args = parser.parse_args(given)
    configure_logging(logging.INFO)
    now = now_ms()
    tasks = {"season-week": _season_week, "usage-backfill": _usage_backfill}
    captures = {"capture-harvest": _capture_harvest, "capture-status": _capture_status}
    ok = tasks[args.task](args, now) if args.task in tasks else captures[args.task](now)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
