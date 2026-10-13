"""The win-totals cases: the committed seed, and the weekly job before the 2026 opener."""

from datetime import UTC, datetime

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext, Script
from research.parity.cases.nflverse_season import NOW
from research.parity.cases.steps import cli, schedule
from research.parity.cases.tables import TEAM_WEEK_OBSERVATIONS
from research.parity.record import RecordSpec
from research.pipeline.preseason.ingest import first_kickoff_for
from research.pipeline.vegas import PUBLISHED_WIN_TOTALS_URL, run_win_totals

# After the publisher's 2026 post (stamped 2026-09-07T06:24Z) and before the opener. A fire before
# the publisher's own stamp would read its rows back as not yet knowable and refuse, on both sides.
JOB_NOW = datetime(2026, 9, 8, 12, 0, tzinfo=UTC)

PUBLISHED = Recording(
    fixture_set="win-totals-published",
    specs=lambda _fetcher: [RecordSpec(url=PUBLISHED_WIN_TOTALS_URL, file="win_totals.csv.gz")],
    note="The win-totals publisher's own file (greerreNFL/nfelosrs), every season it carries, unfiltered.",
)


def _seed(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """`vegas-win-totals-ingest.ts`."""
    return (cli(conn, ctx, ["win-totals-seed"]),)


def _job(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """`refreshWinTotals`, the in-season win-totals task, after the season's schedule."""
    schedule(conn, ctx, [2026])
    run_win_totals(conn, ctx.fetcher, 2026, ctx.now, first_kickoff_for(conn, 2026))
    return ()


CASES: tuple[Case, ...] = (
    Case(
        name="win-totals-seed",
        summary="vegas-win-totals-ingest.ts run as is: the committed CSV (2003-2026), read back and verified",
        fixture_sets=(),
        tables=(TEAM_WEEK_OBSERVATIONS,),
        run_python=_seed,
        now=NOW,
        ts_scripts=(Script("research-ts/scripts/vegas-win-totals-ingest.ts"),),
    ),
    Case(
        name="win-totals-job",
        summary="the weekly win-totals job before the 2026 opener: the publisher's file, a full league or nothing",
        fixture_sets=("nflverse-schedule", "win-totals-published"),
        tables=(TEAM_WEEK_OBSERVATIONS,),
        run_python=_job,
        now=JOB_NOW,
        recordings=(PUBLISHED,),
    ),
)
