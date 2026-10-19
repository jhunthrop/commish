"""THE REGISTER'S WEEKLY PASS (`season-week`), ported from `research-ts/src/projections/season-week/steps.ts`.

Thirteen steps, each isolated: a step that raises is reported as failed and the pass carries on to the
next, because a dead odds key must never stop the freeze that runs after it. The exit status is
non-zero when any step failed.

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
2. **props-snapshot**: the odds provider's player props for the coming fourteen days.
3. **grade**: every frozen week not yet graded, whose games are complete (below), against the
   stats now held. Each grade row is stamped `implementation = 'python'`.
4. **freeze**: the coming week, if no freeze holds it yet, strictly before its first kickoff. A week
   already frozen is ok; a week whose first kickoff passed unfrozen is listed as MISSED (the record
   marks it) but never fails the pass, since nothing can be done for it. The step fails only when
   the coming week could not be frozen.
5. **scoreboard**: the running score, read fresh.

ONE CHANGE FROM THE ORACLE, on purpose: a week is graded only once its last kickoff is
`GRADE_AFTER` behind the pass. The oracle graded any frozen week the store held outcomes for, so a
Wednesday pass could grade Thursday's freeze on its one played game; the register's grade of a week
is final (the pass never regrades), so a partial week would stand. Thirty-six hours after Monday
night's kickoff is Wednesday's pass, by which nflverse has published the week.
"""

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection, Engine, text

from research.errors import ConfigurationError
from research.inseason import usage_steps
from research.inseason.scoreboard import scoreboard_lines
from research.inseason.step_result import Status, StepResult
from research.model.instants import js_iso, ms_instant
from research.model.reads.teams import kickoff_instants_by_week
from research.model.register.freeze import SERVED_SOURCE, take_freeze
from research.model.register.grade import grade_week, latest_freeze_for
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import ingest, season_stats
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.context import ingest_opponent_defence_to_date
from research.pipeline.nflverse.games import ingest_games
from research.pipeline.nflverse.kdef_lines import refresh_kdef_season
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.odds.ingest import run_odds_snapshot

LOG: Final = logging.getLogger(__name__)
GRADE_AFTER: Final = timedelta(hours=36)
# A week still ungradeable this long after its last kickoff fails the pass: nflverse publishes within
# two days, so a refusal past this is an outage an operator must see, not a wait.
GRADE_OVERDUE: Final = timedelta(days=4)
LAST_POSSIBLE_WEEK: Final = 22
OPPONENT_RATINGS: Final = "opponent-ratings"
GAME_TABLE: Final = "game-table"
KICKING_DEFENSE: Final = "kicking-defense"
STEPS: Final = (
    "stats-ingest",
    *usage_steps.USAGE_STEPS,
    OPPONENT_RATINGS,
    GAME_TABLE,
    KICKING_DEFENSE,
    "props-snapshot",
    "grade",
    "freeze",
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
        if context.now < last + GRADE_AFTER:
            detail.append(f"week {week}: waits, its last kickoff {js_iso(last)} is under {GRADE_AFTER} ago")
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
    if existing is not None:
        return StepResult("freeze", "ok", f"week {week} already frozen at {js_iso(existing)}")
    with context.engine.begin() as conn:
        result = take_freeze(conn, context.season, week, context.now)
    context.on_freeze(week, result.frozen_at)
    served = sum(1 for row in result.rows if row["board_source"] == SERVED_SOURCE)
    summary = (
        f"froze week {week} at {js_iso(result.frozen_at)}, kickoff {js_iso(kickoff)}, {len(result.rows)} rows "
        f"({served} on the served board), implementation python"
    )
    return StepResult(
        "freeze", "ok", summary, tuple(f"{source}: {counts}" for source, counts in result.coverage.items())
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
        "stats-ingest": lambda: stats_ingest(context),
        **{name: _usage_body(name, context) for name in usage_steps.USAGE_STEPS},
        OPPONENT_RATINGS: lambda: opponent_ratings(context),
        GAME_TABLE: lambda: game_table(context),
        KICKING_DEFENSE: lambda: kicking_defense(context),
        "props-snapshot": lambda: props_snapshot(context),
        "grade": lambda: grade(context),
        "freeze": lambda: freeze(context),
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
