"""THE REGISTER'S WEEKLY PASS (`season-week`), ported from `research-ts/src/projections/season-week/steps.ts`.

Five steps, each isolated: a step that raises is reported as failed and the pass carries on to the
next, because a dead odds key must never stop the freeze that runs after it. The exit status is
non-zero when any step failed.

1. **stats-ingest**: the nflverse universe and the season's published weekly stats (idempotent).
2. **props-snapshot**: the odds provider's player props for the coming fourteen days.
3. **grade**: every frozen week not yet graded, whose games are complete (below), against the
   stats now held. Each grade row is stamped `implementation = 'python'`.
4. **freeze**: the coming week, if no freeze holds it yet, strictly before its first kickoff.
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
from typing import Final, Literal

from sqlalchemy import Connection, Engine, text

from research.errors import ConfigurationError
from research.inseason.scoreboard import scoreboard_lines
from research.model.instants import js_iso, ms_instant
from research.model.reads.teams import kickoff_instants_by_week
from research.model.register.freeze import SERVED_SOURCE, take_freeze
from research.model.register.grade import grade_week, latest_freeze_for
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import ingest
from research.pipeline.nflverse.client import NflverseClient
from research.pipeline.nflverse.schedule import ScheduleMetric, ScheduleSource
from research.pipeline.odds.ingest import run_odds_snapshot

LOG: Final = logging.getLogger(__name__)
GRADE_AFTER: Final = timedelta(hours=36)
LAST_POSSIBLE_WEEK: Final = 22
STEPS: Final = ("stats-ingest", "props-snapshot", "grade", "freeze", "scoreboard")

Status = Literal["ok", "skipped", "failed"]


@dataclass(frozen=True, slots=True)
class StepResult:
    step: str
    status: Status
    summary: str
    detail: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class SeasonWeekContext:
    """What a pass reads from outside the database, handed in."""

    engine: Engine
    fetcher: Fetcher
    now: datetime
    season: int
    environ: Mapping[str, str]
    skip: frozenset[str] = field(default_factory=frozenset)


def _safely(name: str, body: Callable[[], StepResult], context: SeasonWeekContext) -> StepResult:
    if name in context.skip:
        return StepResult(name, "skipped", "skipped by --skip")
    try:
        return body()
    except Exception as error:
        LOG.exception("season-week step %s failed", name)
        return StepResult(name, "failed", str(error))


def stats_ingest(context: SeasonWeekContext) -> StepResult:
    """The universe, then the season's participation, stat lines and team edges, committed after each."""
    client = NflverseClient(context.fetcher)
    with context.engine.connect() as conn:
        universe = ingest.ingest_player_universe(conn, client)
        conn.commit()
        as_of = ingest.schedule_week_as_of(client, [context.season]).get(context.season)
        report = ingest.ingest_season(conn, client, universe, context.season, as_of)
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
    for week in ungraded:
        last = last_kickoffs.get(week)
        if last is None or context.now < last + GRADE_AFTER:
            when = (
                "no kickoff on file" if last is None else f"its last kickoff {js_iso(last)} is under {GRADE_AFTER} ago"
            )
            detail.append(f"week {week}: waits, {when}")
            continue
        try:
            with context.engine.begin() as conn:
                result = grade_week(conn, context.season, week, context.now)
        except ValueError as error:
            detail.append(f"week {week}: not graded, {error}")
            continue
        count += 1
        boards = " ".join(f"{board.board_source}={board.population}" for board in result.boards)
        skipped = "".join(f" SKIPPED {board.board_source}" for board in result.skipped)
        detail.append(f"week {week}: graded {boards}{skipped}")
    return StepResult(
        "grade", "ok" if count else "skipped", f"{len(ungraded)} ungraded weeks, {count} graded", tuple(detail)
    )


def week_to_freeze(kickoffs: Mapping[int, datetime], now: datetime) -> tuple[int, datetime] | None:
    """`pickWeekToFreeze`: the smallest week whose first kickoff is still ahead."""
    upcoming = sorted((week, kickoff) for week, kickoff in kickoffs.items() if kickoff > now)
    return upcoming[0] if upcoming else None


def freeze(context: SeasonWeekContext) -> StepResult:
    """The coming week's freeze, unless one already holds it (a re-freeze is an operator's act)."""
    with context.engine.connect() as conn:
        candidate = week_to_freeze(kickoff_instants_by_week(conn, context.season), context.now)
        if candidate is None:
            return StepResult("freeze", "skipped", f"no week of {context.season} kicks off after {js_iso(context.now)}")
        week, kickoff = candidate
        existing = latest_freeze_for(conn, context.season, week)
    if existing is not None:
        return StepResult("freeze", "skipped", f"week {week} already frozen at {js_iso(existing)}")
    with context.engine.begin() as conn:
        result = take_freeze(conn, context.season, week, context.now)
    served = sum(1 for row in result.rows if row["board_source"] == SERVED_SOURCE)
    detail = tuple(f"{source}: {counts}" for source, counts in result.coverage.items())
    return StepResult(
        "freeze",
        "ok",
        f"froze week {week} at {js_iso(result.frozen_at)}, kickoff {js_iso(kickoff)}, {len(result.rows)} rows "
        f"({served} on the served board), implementation python",
        detail,
    )


def scoreboard(context: SeasonWeekContext) -> StepResult:
    with context.engine.connect() as conn:
        lines = scoreboard_lines(conn, context.season)
    return StepResult("scoreboard", "ok", f"season {context.season} running scoreboard", tuple(lines))


def run_season_week(context: SeasonWeekContext) -> list[StepResult]:
    """The five steps in order, each isolated."""
    bodies: dict[str, Callable[[], StepResult]] = {
        "stats-ingest": lambda: stats_ingest(context),
        "props-snapshot": lambda: props_snapshot(context),
        "grade": lambda: grade(context),
        "freeze": lambda: freeze(context),
        "scoreboard": lambda: scoreboard(context),
    }
    return [_safely(name, bodies[name], context) for name in STEPS]
