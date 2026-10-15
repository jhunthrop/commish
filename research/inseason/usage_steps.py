"""THE WEEKLY PASS'S USAGE STEPS: the season's play-by-play and the three charted feeds.

Each runs after `stats-ingest` (the universe the feeds' players are checked against is refreshed
there) and is its own step: a failure is that step's line, never the pass's. A season nflverse has
not published yet (a 404, or no row of it in an all-seasons file) is `skipped`, as `stats-ingest`
skips a season with no weekly stats; a file with a header and no rows is refused (`failed`). A run
that finds nothing new (the week is already stored) is `skipped` with its counts, `ok` when it wrote.
Every write is through the observation writer's conflict rule, so a re-run writes nothing.

Every row is stamped at or after its game's day plus the publication lag (`config`), the same stamps
the history pass writes for earlier seasons, and nothing here is read by a fit or a gate: the fits'
season windows end before the product season (`tests/test_fit_windows.py`).
"""

from collections.abc import Callable
from typing import Final

from sqlalchemy import Engine

from research.inseason.step_result import Status, StepResult
from research.pipeline.http import Fetcher
from research.pipeline.nflverse import context, ingest, usage_feeds
from research.pipeline.nflverse.client import NflverseClient, NflverseError
from research.pipeline.nflverse.config import ByteCaps
from research.pipeline.nflverse.pbp_passers import PasserDropbacks
from research.pipeline.nflverse.usage_feeds import FeedReport

PLAY_BY_PLAY: Final = "play-by-play"
FTN_CHARTING: Final = "ftn-charting"
NEXT_GEN_STATS: Final = "next-gen-stats"
PFR_ADVSTATS: Final = "pfr-advstats"
USAGE_STEPS: Final = (PLAY_BY_PLAY, FTN_CHARTING, NEXT_GEN_STATS, PFR_ADVSTATS)

UsageStep = Callable[[Engine, Fetcher, int], StepResult]


def _written(step: str, written: int, summary: str, detail: tuple[str, ...] = ()) -> StepResult:
    status: Status = "ok" if written > 0 else "skipped"
    return StepResult(step, status, summary if written > 0 else f"nothing new, {summary}", detail)


def _unpublished(step: str, what: str, season: int, error: NflverseError) -> StepResult:
    return StepResult(step, "skipped", f"nflverse has not published {what} for {season} yet ({error.asset})")


def play_by_play(engine: Engine, fetcher: Fetcher, season: int) -> StepResult:
    """The season's play-by-play: the team and player facts the history pass writes, and each
    passer's dropbacks, from one stream."""
    client = NflverseClient(fetcher, max_bytes=ByteCaps.PLAY_BY_PLAY)
    try:
        with engine.connect() as conn:
            report = context.ingest_play_by_play(conn, client, season, passers=PasserDropbacks())
            if report.plays_read == 0:
                raise NflverseError("malformed", f"play_by_play_{season}.csv", "play-by-play has a header and no rows")
            conn.commit()
    except NflverseError as error:
        if error.kind != "not_found":
            raise
        return _unpublished(PLAY_BY_PLAY, "play-by-play", season, error)
    summary = (
        f"{report.observations_written} new observations for {season} ({report.plays_read} plays, "
        f"{report.team_weeks} team-weeks, {report.player_weeks} player-weeks, {report.passer_weeks} passer-weeks, "
        f"{report.unknown_players} ids outside the projected universe)"
    )
    return _written(PLAY_BY_PLAY, report.observations_written, summary)


def _feed(step: str, what: str, season: int, run: Callable[[], FeedReport]) -> StepResult:
    try:
        report = run()
    except NflverseError as error:
        if error.kind != "not_found":
            raise
        return _unpublished(step, what, season, error)
    if not report.published:
        return StepResult(step, "skipped", f"nflverse has not published {what} for {season} yet", report.detail)
    return _written(step, report.observations_written, report.summary(), report.detail)


def ftn_charting(engine: Engine, fetcher: Fetcher, season: int) -> StepResult:
    def run() -> FeedReport:
        with engine.connect() as conn:
            report = usage_feeds.ingest_ftn_charting(conn, NflverseClient(fetcher), season)
            conn.commit()
        return report

    return _feed(FTN_CHARTING, "FTN charting", season, run)


def next_gen_stats(engine: Engine, fetcher: Fetcher, season: int) -> StepResult:
    def run() -> FeedReport:
        client = NflverseClient(fetcher)
        try:
            week_as_of = ingest.schedule_week_as_of(client, [season]).get(season, {})
        except NflverseError as error:
            # The schedule is the stamp, never the feed: its absence is a failure, not an unpublished feed.
            raise NflverseError("upstream", error.asset, f"the schedule could not be read: {error}") from error
        with engine.connect() as conn:
            report = usage_feeds.ingest_next_gen_stats(conn, client, season, week_as_of)
            conn.commit()
        return report

    return _feed(NEXT_GEN_STATS, "Next Gen Stats", season, run)


def pfr_advstats(engine: Engine, fetcher: Fetcher, season: int) -> StepResult:
    def run() -> FeedReport:
        with engine.connect() as conn:
            report = usage_feeds.ingest_pfr_advstats(conn, NflverseClient(fetcher), season)
            conn.commit()
        return report

    return _feed(PFR_ADVSTATS, "PFR advanced stats", season, run)


BODIES: Final[dict[str, UsageStep]] = {
    PLAY_BY_PLAY: play_by_play,
    FTN_CHARTING: ftn_charting,
    NEXT_GEN_STATS: next_gen_stats,
    PFR_ADVSTATS: pfr_advstats,
}
