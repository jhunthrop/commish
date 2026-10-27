"""THE REGISTER'S WEEKLY PASS (`season-week`), ported from `research-ts/src/projections/season-week/steps.ts`.

Sixteen steps, each isolated: a step that raises is reported as failed and the pass carries on to the
next, because a dead odds key must never stop the freeze that runs after it. The exit status is
non-zero when any step failed.

0. **player-list**: on the week's final pass (the Thursday 14:00 Eastern pass, `is_final_pass`), the
   provider's player list read again before the freeze (Lane 160, B138): the daily list's same feed and
   tables (`pipeline/tank01/capture.read_player_list`), one request, so a return date the provider moved
   since 06:00 reaches the API's `returnDates` within the hour. Any other pass skips it by name; a failed
   read fails this step alone, never the freeze. Needs TANK01_API_KEY.
1. **stats-ingest**: the nflverse universe and the season's published weekly stats (idempotent).
1a. **play-by-play**, **ftn-charting**, **next-gen-stats**, **pfr-advstats**: the season's
   play-by-play and the three charted feeds (`usage_steps`), each skipped until nflverse publishes it.
1b. **opponent-ratings**: each club's opponent's pass and rush defence ratings
   (`commish_opponent_adjustment`), from the play-by-play just stored, for every week whose earlier
   games are all in it (`ingest_opponent_defence_to_date`): the weekly number's opponent factor
   (`docs/research/2026-10-15-weekly-projection-round2-preregistration.md`, section 4's build items).
1c. **game-table**: nflverse's game table for the season into `nflverse_games` (Lane 66a): the
   kickoffs and venues the hourly forecast reads, and the figures the live default falls back to.
1d. **kicking-defense**: the season's kicking and team-defense weeks (`nflverse_kicking_weeks`,
   `nflverse_team_defense_weeks`), then both as stat lines the API reads (`kdef_lines`, source
   `nflverse_kdef_week`), each stamped as its club's lines that week (Lane 70a).
1e. **espn-projections**: ESPN's public weekly projection for the coming week (Lane 114,
   `pipeline/espn/projections.py`), read before the freeze so the order set on this pass keeps a read
   taken minutes before it (`espn_points`); a failed read fails this step alone, never the freeze.
2. **props-snapshot**: the odds provider's player props for the coming fourteen days.
3. **grade**: every frozen week not yet graded, whose games are complete (below), against the
   stats now held. It runs after every ingest above on the same pass, so one pass fetches a
   week's last lines and grades it. Each grade row is stamped `implementation = 'python'`.
4. **freeze**: the coming week, if no freeze holds it yet, strictly before its first kickoff, and
   again on the final pass before that kickoff (`FINAL_FREEZE_BEFORE`, Lane 93), which supersedes
   the early freeze so the week's order is set once, on the Thursday pass. A week already frozen is
   ok; a week whose first kickoff passed unfrozen is listed as MISSED (the record marks it) but
   never fails the pass, since nothing can be done for it. The step fails only when the coming week
   could not be frozen.
4a. **espn-fill**: the coming week's standing freeze, when it kept no ESPN figure (its read failed or
   was not yet published), takes the first ESPN read taken after it and before the week's first
   kickoff, on its rows with none, the read's instant kept as `espn_read_at` (Amendment 6, Lane 146,
   `model/register/espn_fill.py`). A freeze that kept ESPN's read is untouched; a read at or after the
   first kickoff never fills.
5. **scoreboard**: the running score, read fresh.

ONE CHANGE FROM THE ORACLE, on purpose: a week is graded only once it is complete. The oracle graded
any frozen week the store held outcomes for, so a Wednesday pass could grade Thursday's freeze on its
one played game; the register's grade of a week is final (the pass never regrades), so a partial week
would stand. A week is complete (Lane 244) on the first pass where every club with a kickoff that week
(the same nflverse kickoff observations `last_kickoffs_by_week` reads) holds its game's final result
and nflverse player-week stat lines for its players, each as of the pass, the instant the grade reads
its lines at; until then the pass names the clubs it waits on. `GRADE_FLOOR` after the last kickoff
keeps a pass that lands between a final whistle and nflverse's next publish from reading a game half
ingested. The store dates a game's lines the end of its Eastern day plus `PUBLICATION_LAG_HOURS`, so a
Monday night week is first complete on Tuesday evening Eastern (`earliest_grade`). Lane 244 replaced
the thirty-six hour wait (`GRADE_AFTER`) the pass held before, which the draft record still counts by.
"""

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from sqlalchemy import Connection, Engine, text

from research.errors import ConfigurationError
from research.inseason import usage_steps
from research.inseason.scoreboard import scoreboard_lines
from research.inseason.step_result import Status, StepResult
from research.model.instants import js_iso, ms_instant
from research.model.reads.teams import kickoff_instants_by_week
from research.model.register.espn_fill import fill_empty_espn_yardstick
from research.model.register.freeze import SERVED_SOURCE, SHIPPED_SOURCE, take_freeze
from research.model.register.grade import grade_week, latest_freeze_for
from research.pipeline.budget import FixedBudget
from research.pipeline.espn import projections as espn_projections
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import ingest, season_stats
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.config import PUBLICATION_LAG_HOURS
from research.pipeline.nflverse.context import ingest_opponent_defence_to_date
from research.pipeline.nflverse.games import ingest_games
from research.pipeline.nflverse.kdef_lines import refresh_kdef_season
from research.pipeline.nflverse.participation import NflverseSource
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource, kickoff_as_of
from research.pipeline.odds.ingest import run_odds_snapshot
from research.pipeline.tank01.capture import PLAYER_LIST_REQUESTS, read_player_list
from research.pipeline.tank01.client import API_KEY_ENV, Tank01Client

LOG: Final = logging.getLogger(__name__)
# The draft record's complete-week line (`nightly/reads/draft_record.py`); the pass grades on
# completeness since Lane 244.
GRADE_AFTER: Final = timedelta(hours=36)
# No week grades sooner than this after its last kickoff, its stat lines held or not (Lane 244): a pass
# between a final whistle and nflverse's next publish must not see a game half ingested.
GRADE_FLOOR: Final = timedelta(hours=6)
_EASTERN: Final = ZoneInfo("America/New_York")
# The week's order is set on the last pass before its first kickoff (Lane 93, B37): the Thursday 14:00
# Eastern pass, six hours before a Thursday night game, is the one inside this window. The first pass
# after the previous week's first kickoff still freezes the week early, so a failed final pass leaves
# a freeze standing rather than a missed week; the final pass supersedes it by a new freeze instant
# (the register's rule: rows never update, the latest freeze before kickoff is the one graded).
FINAL_FREEZE_BEFORE: Final = timedelta(hours=12)
# A week still ungradeable this long after its last kickoff fails the pass: nflverse publishes within
# two days, so a refusal past this is an outage an operator must see, not a wait.
GRADE_OVERDUE: Final = timedelta(days=4)
LAST_POSSIBLE_WEEK: Final = 22
OPPONENT_RATINGS: Final = "opponent-ratings"
GAME_TABLE: Final = "game-table"
KICKING_DEFENSE: Final = "kicking-defense"
ESPN_PROJECTIONS: Final = "espn-projections"
ESPN_FILL: Final = "espn-fill"
PLAYER_LIST: Final = "player-list"
STEPS: Final = (
    PLAYER_LIST,
    "stats-ingest",
    *usage_steps.USAGE_STEPS,
    OPPONENT_RATINGS,
    GAME_TABLE,
    KICKING_DEFENSE,
    ESPN_PROJECTIONS,
    "props-snapshot",
    "grade",
    "freeze",
    ESPN_FILL,
    "scoreboard",
)


@dataclass(frozen=True, slots=True)
class SeasonWeekContext:
    """What a pass reads from outside the database, handed in."""

    engine: Engine
    fetcher: Fetcher
    now: datetime
    season: int
    environ: Mapping[str, str]
    skip: frozenset[str] = field(default_factory=frozenset)
    # Told of each freeze taken (week, instant), so the bucket's trail names the pass that took it.
    on_freeze: Callable[[int, datetime], None] = lambda week, at: None


def _safely(name: str, body: Callable[[], StepResult], context: SeasonWeekContext) -> StepResult:
    if name in context.skip:
        return StepResult(name, "skipped", "skipped by --skip")
    try:
        return body()
    except Exception as error:
        LOG.exception("season-week step %s failed", name)
        return StepResult(name, "failed", str(error))


def player_list(context: SeasonWeekContext) -> StepResult:
    """The player list read again on the week's final pass, before the freeze (Lane 160): its outcome as
    the harvest's line names it, a failure failing this step alone."""
    with context.engine.connect() as conn:
        candidate = week_to_freeze(kickoff_instants_by_week(conn, context.season), context.now)
    if candidate is None or not is_final_pass(candidate[1], context.now):
        return StepResult(PLAYER_LIST, "skipped", "not the week's final pass; the harvest's daily read stands")
    key = context.environ.get(API_KEY_ENV, "").strip()
    if not key:
        raise ConfigurationError(f"{API_KEY_ENV} is not set.")
    client = Tank01Client(context.fetcher, key)
    with context.engine.begin() as conn:
        outcome = read_player_list(conn, client, context.now, context.season, FixedBudget(PLAYER_LIST_REQUESTS))
    words = ", ".join(w for w in (outcome.reason, outcome.note) if w)
    summary = f"week {candidate[0]}: {outcome.status}, {outcome.requests} requests" + (f", {words}" if words else "")
    return StepResult(PLAYER_LIST, "failed" if outcome.status == "failed" else "ok", summary)


def stats_ingest(context: SeasonWeekContext) -> StepResult:
    """The universe, then the season's participation, stat lines, team edges and game results, the
    lines and results committed together (`season_stats`, the `season` command's same unit)."""
    client = NflverseClient(context.fetcher)
    with context.engine.connect() as conn:
        universe = ingest.ingest_player_universe(conn, client)
        conn.commit()
        as_of = ingest.schedule_week_as_of(client, [context.season]).get(context.season)
        # Each game's result rides with its lines: the feed's own final flag, which the nightly's game
        # log reads (a week with no line is inactive only once his club's game is final).
        report = season_stats.ingest_season_and_results(conn, client, universe, context.season, as_of)
        conn.commit()
    if report.player_week_unavailable:
        return StepResult(
            "stats-ingest", "skipped", f"nflverse has not published weekly stats for {context.season} yet"
        )
    status: Status = "ok" if report.observations_written > 0 else "skipped"
    return StepResult(
        "stats-ingest",
        status,
        f"{report.observations_written} new observations for {context.season} ({report.stat_lines} stat lines, "
        f"{report.participation_rows} participation rows, {report.player_team_edges} player-team edges)",
    )


def opponent_ratings(context: SeasonWeekContext) -> StepResult:
    """The season's opponent ratings for every informed week; a re-run writes nothing new."""
    with context.engine.connect() as conn:
        written = ingest_opponent_defence_to_date(conn, NflverseClient(context.fetcher), context.season)
        conn.commit()
    return usage_steps.written_result(
        OPPONENT_RATINGS, written, f"{written} new opponent-rating rows for {context.season}"
    )


def game_table(context: SeasonWeekContext) -> StepResult:
    """The season's games as nflverse lists them now; a re-run over an unchanged file writes nothing."""
    with context.engine.begin() as conn:
        report = ingest_games(conn, NflverseClient(context.fetcher), [context.season], context.now)
    return usage_steps.written_result(
        GAME_TABLE, report.written, f"{report.written} games of {context.season} written or updated"
    )


def kicking_defense(context: SeasonWeekContext) -> StepResult:
    """The season's kicking and team-defense weeks, then their stat lines (`kdef_lines`), each club-week
    stamped as its club's lines; a re-run writes nothing."""
    try:
        with context.engine.connect() as conn:
            refresh = refresh_kdef_season(conn, NflverseClient(context.fetcher), context.season)
            conn.commit()
    except NflverseError as error:
        if error.kind != "not_found":
            raise
        return StepResult(
            KICKING_DEFENSE,
            "skipped",
            f"nflverse has not published kicking or team stats for {context.season} yet ({error.asset})",
        )
    return usage_steps.written_result(
        KICKING_DEFENSE, refresh.written, refresh.summary(context.season), refresh.detail()
    )


def espn_projections_step(context: SeasonWeekContext) -> StepResult:
    """ESPN's projection for the week the freeze sets next, read once and kept at the pass's instant."""
    with context.engine.connect() as conn:
        candidate = week_to_freeze(kickoff_instants_by_week(conn, context.season), context.now)
    if candidate is None:
        return StepResult(
            ESPN_PROJECTIONS, "skipped", f"no week of {context.season} kicks off after {js_iso(context.now)}"
        )
    week, _ = candidate
    with context.engine.begin() as conn:
        read = espn_projections.read_week(conn, context.fetcher, context.season, week, context.now)
    if not read.published:
        return StepResult(ESPN_PROJECTIONS, "skipped", f"ESPN lists no projection for {context.season} week {week} yet")
    return StepResult(
        ESPN_PROJECTIONS,
        "ok",
        f"week {week}: {read.listed} players projected, {read.written} rows kept at {js_iso(context.now)}",
    )


def props_snapshot(context: SeasonWeekContext) -> StepResult:
    key = context.environ.get("ODDS_API_KEY", "").strip()
    if not key:
        raise ConfigurationError("ODDS_API_KEY is not set.")
    with context.engine.begin() as conn:
        summary = run_odds_snapshot(conn, context.fetcher, key, context.now)
    return StepResult(
        "props-snapshot",
        "ok",
        f"{summary.total_events} events ({summary.selected_events} snapshotted), {summary.total_written} observations "
        f"written, {summary.total_skipped} single-sided lines skipped; credits remaining {summary.credits.remaining}, "
        f"used {summary.credits.used}",
    )


def last_kickoffs_by_week(conn: Connection, season: int) -> dict[int, datetime]:
    """Each week's latest kickoff instant, from the nflverse schedule's kickoff observations."""
    rows = conn.execute(
        text(
            "select week, max(as_of) as latest from research.team_week_observations "
            "where season = :s and source = :source and metric = :metric group by week"
        ),
        {"s": season, "source": ScheduleSource.KICKOFF, "metric": ScheduleMetric.KICKOFF_INSTANT},
    )
    return {int(row.week): ms_instant(row.latest) for row in rows if row.latest is not None}


_CLUBS_HELD: Final = """
select k.team,
  exists(
    select 1 from research.team_week_observations r
    where r.season = k.season and r.week = k.week and r.team = k.team
      and r.source = :kickoff and r.metric = :result and r.as_of <= :now
  ) as final,
  exists(
    select 1 from research.player_week_teams t
    join research.player_week_observations o
      on o.season = t.season and o.week = t.week and o.player_id = t.player_id
    where t.season = k.season and t.week = k.week and t.team = k.team and o.source = :lines and o.as_of <= :now
  ) as lined
from (
  select distinct season, week, team from research.team_week_observations
  where season = :s and week = :w and source = :kickoff and metric = :kickoff_instant
) k
order by k.team
"""


def incomplete_clubs(conn: Connection, season: int, week: int, now: datetime) -> list[str]:
    """Each club with a kickoff in the week whose game the store does not yet hold whole as of `now`,
    with what it lacks ("DAL no final", "PHI no stat lines"): its final result (the nflverse game
    result `stats-ingest` writes with the lines) and a stat line for one of its players that week (the
    nflverse player-week source `grade_week` reads). Empty when the week is complete."""
    params = {
        "s": season,
        "w": week,
        "now": now,
        "kickoff": ScheduleSource.KICKOFF,
        "kickoff_instant": ScheduleMetric.KICKOFF_INSTANT,
        "result": ScheduleMetric.GAME_RESULT,
        "lines": NflverseSource.PLAYER_WEEK,
    }
    missing: list[str] = []
    for row in conn.execute(text(_CLUBS_HELD), params):
        lacks = [word for word, held in (("no final", row.final), ("no stat lines", row.lined)) if not held]
        if lacks:
            missing.append(f"{row.team} {' and '.join(lacks)}")
    return missing


def earliest_grade(last_kickoff: datetime) -> datetime:
    """The first instant a week can be complete: its last game's lines are dated the end of that game's
    Eastern day plus `PUBLICATION_LAG_HOURS` (`kickoff_as_of`), never sooner than `GRADE_FLOOR`. A
    Monday night week's is Tuesday evening Eastern; the record says its day from this."""
    gameday = last_kickoff.astimezone(_EASTERN).date().isoformat()
    return max(last_kickoff + GRADE_FLOOR, kickoff_as_of(gameday, PUBLICATION_LAG_HOURS))


def _frozen_and_graded(conn: Connection, season: int) -> tuple[list[int], set[int]]:
    frozen = [
        int(row.week)
        for row in conn.execute(
            text("select distinct week from research.register_freeze_rows where season = :s order by week"),
            {"s": season},
        )
        if 1 <= row.week <= LAST_POSSIBLE_WEEK
    ]
    graded = {
        int(row.week)
        for row in conn.execute(
            text("select distinct week from research.register_grade_rows where season = :s"), {"s": season}
        )
    }
    return frozen, graded


def grade(context: SeasonWeekContext) -> StepResult:
    """Every frozen week with no grade yet whose games are complete, each in its own transaction."""
    with context.engine.connect() as conn:
        frozen, graded = _frozen_and_graded(conn, context.season)
        last_kickoffs = last_kickoffs_by_week(conn, context.season)
    ungraded = [week for week in frozen if week not in graded]
    if not ungraded:
        return StepResult("grade", "skipped", f"no ungraded weeks ({len(frozen)} frozen, all graded)")
    detail: list[str] = []
    count = 0
    failed = False
    for week in ungraded:
        last = last_kickoffs.get(week)
        if last is None:
            # No kickoff on file never grades; once the freeze is older than the overdue line it fails.
            with context.engine.connect() as conn:
                frozen_at = latest_freeze_for(conn, context.season, week)
            stale = frozen_at is not None and context.now >= frozen_at + GRADE_OVERDUE
            detail.append(f"week {week}: {'OVERDUE, ' if stale else ''}waits, no kickoff on file")
            failed = failed or stale
            continue
        if context.now < last + GRADE_FLOOR:
            detail.append(f"week {week}: waits, its last kickoff {js_iso(last)} is under {GRADE_FLOOR} ago")
            continue
        with context.engine.connect() as conn:
            missing = incomplete_clubs(conn, context.season, week, context.now)
        if missing:
            overdue = context.now >= last + GRADE_OVERDUE
            waits = f"waits on {len(missing)} clubs, {', '.join(missing)}"
            detail.append(f"week {week}: {'OVERDUE, ' if overdue else ''}{waits}")
            failed = failed or overdue
            continue
        try:
            with context.engine.begin() as conn:
                result = grade_week(conn, context.season, week, context.now)
        except ValueError as error:
            overdue = context.now >= last + GRADE_OVERDUE
            detail.append(f"week {week}: {'OVERDUE, ' if overdue else ''}not graded, {error}")
            failed = failed or overdue
            continue
        count += 1
        boards = " ".join(f"{board.board_source}={board.population}" for board in result.boards)
        skipped = "".join(f" SKIPPED {board.board_source}" for board in result.skipped)
        detail.append(f"week {week}: graded {boards}{skipped}")
    status: Status = "failed" if failed else ("ok" if count else "skipped")
    return StepResult("grade", status, f"{len(ungraded)} ungraded weeks, {count} graded", tuple(detail))


def is_final_pass(kickoff: datetime, at: datetime) -> bool:
    """Whether an instant is inside the week's final freeze window, `FINAL_FREEZE_BEFORE` before its
    first kickoff (Lane 93, B37): the pass there sets the week's order, superseding an early freeze."""
    return kickoff - FINAL_FREEZE_BEFORE <= at < kickoff


def week_to_freeze(kickoffs: Mapping[int, datetime], now: datetime) -> tuple[int, datetime] | None:
    """`pickWeekToFreeze`: the smallest week whose first kickoff is still ahead."""
    upcoming = sorted((week, kickoff) for week, kickoff in kickoffs.items() if kickoff > now)
    return upcoming[0] if upcoming else None


def missed_weeks(kickoffs: Mapping[int, datetime], frozen: set[int], now: datetime) -> list[tuple[int, datetime]]:
    """Every week whose first kickoff has passed with no freeze."""
    return sorted((week, kickoff) for week, kickoff in kickoffs.items() if kickoff <= now and week not in frozen)


def freeze(context: SeasonWeekContext) -> StepResult:
    """The coming week's freeze, unless one already holds it (a re-freeze is an operator's act), with
    every missed week listed. A miss is past repair and the record already marks it, so it never
    fails the step; only a coming week that could not be frozen does, which raises out of here."""
    with context.engine.connect() as conn:
        kickoffs = kickoff_instants_by_week(conn, context.season)
        candidate = week_to_freeze(kickoffs, context.now)
        frozen, _ = _frozen_and_graded(conn, context.season)
    taken = _take_freeze(context, candidate)
    missed = missed_weeks(kickoffs, set(frozen), context.now)
    detail = (
        *taken.detail,
        *(f"week {week}: MISSED, no freeze before its first kickoff {js_iso(k)}" for week, k in missed),
    )
    return StepResult("freeze", taken.status, taken.summary, detail)


def _take_freeze(context: SeasonWeekContext, candidate: tuple[int, datetime] | None) -> StepResult:
    if candidate is None:
        return StepResult("freeze", "skipped", f"no week of {context.season} kicks off after {js_iso(context.now)}")
    week, kickoff = candidate
    with context.engine.connect() as conn:
        existing = latest_freeze_for(conn, context.season, week)
    final = is_final_pass(kickoff, context.now)
    if existing is not None and (not final or is_final_pass(kickoff, existing)):
        return StepResult("freeze", "ok", f"week {week} already frozen at {js_iso(existing)}")
    with context.engine.begin() as conn:
        result = take_freeze(conn, context.season, week, context.now)
    context.on_freeze(week, result.frozen_at)
    served = sum(1 for row in result.rows if row["board_source"] == SERVED_SOURCE)
    shipped = sum(1 for row in result.rows if row["board_source"] == SHIPPED_SOURCE)
    superseded = "" if existing is None else f", superseding the early freeze at {js_iso(existing)}"
    summary = (
        f"froze week {week} at {js_iso(result.frozen_at)}, kickoff {js_iso(kickoff)}, {len(result.rows)} rows "
        f"({served} on the served board, {shipped} on the order shipped){superseded}, implementation python"
    )
    return StepResult(
        "freeze", "ok", summary, tuple(f"{source}: {counts}" for source, counts in result.coverage.items())
    )


def espn_fill(context: SeasonWeekContext) -> StepResult:
    """The coming week's standing freeze filled from the first ESPN read before kickoff, if it kept none."""
    with context.engine.connect() as conn:
        candidate = week_to_freeze(kickoff_instants_by_week(conn, context.season), context.now)
    if candidate is None:
        return StepResult(ESPN_FILL, "skipped", f"no week of {context.season} kicks off after {js_iso(context.now)}")
    week, kickoff = candidate
    with context.engine.begin() as conn:
        fill = fill_empty_espn_yardstick(conn, context.season, week, kickoff)
    if fill.reason is not None or fill.read_at is None:
        return StepResult(ESPN_FILL, "skipped", f"week {week}: {fill.reason}")
    return StepResult(
        ESPN_FILL, "ok", f"week {week}: filled {fill.filled} rows from the read at {js_iso(fill.read_at)}"
    )


def scoreboard(context: SeasonWeekContext) -> StepResult:
    with context.engine.connect() as conn:
        lines = scoreboard_lines(conn, context.season)
    return StepResult("scoreboard", "ok", f"season {context.season} running scoreboard", tuple(lines))


def _usage_body(name: str, context: SeasonWeekContext) -> Callable[[], StepResult]:
    body = usage_steps.BODIES[name]
    return lambda: body(context.engine, context.fetcher, context.season)


def _bodies(context: SeasonWeekContext) -> dict[str, Callable[[], StepResult]]:
    return {
        PLAYER_LIST: lambda: player_list(context),
        "stats-ingest": lambda: stats_ingest(context),
        **{name: _usage_body(name, context) for name in usage_steps.USAGE_STEPS},
        OPPONENT_RATINGS: lambda: opponent_ratings(context),
        GAME_TABLE: lambda: game_table(context),
        KICKING_DEFENSE: lambda: kicking_defense(context),
        ESPN_PROJECTIONS: lambda: espn_projections_step(context),
        "props-snapshot": lambda: props_snapshot(context),
        "grade": lambda: grade(context),
        "freeze": lambda: freeze(context),
        ESPN_FILL: lambda: espn_fill(context),
        "scoreboard": lambda: scoreboard(context),
    }


def run_season_week(context: SeasonWeekContext) -> list[StepResult]:
    """Every step in order, each isolated."""
    bodies = _bodies(context)
    return [_safely(name, bodies[name], context) for name in STEPS]


def run_usage_backfill(context: SeasonWeekContext) -> list[StepResult]:
    """The usage steps alone, each isolated: the operator's one-shot for weeks already played."""
    bodies = _bodies(context)
    return [_safely(name, bodies[name], context) for name in usage_steps.USAGE_STEPS]
