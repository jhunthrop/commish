"""The capture-harvest case: the job's five feeds, fired twice an hour apart on the same recorded
responses, so the second fire exercises the unchanged-digest path on both sides."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import Connection

from research.parity.case import Case, Recording, RunContext
from research.parity.cases.tables import CAPTURE_SNAPSHOTS
from research.parity.cases.tank01 import REPLAY_KEY, _live_client
from research.parity.record import RecordSpec
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_iso
from research.pipeline.tank01.capture import CaptureContext, harvest_feeds, run_capture_harvest
from research.pipeline.tank01.client import Tank01Client

# A Monday: the game-day feeds (the line, the inactives) are due alongside the daily ones.
FIRED_AT = datetime(2026, 10, 12, 6, 0, tzinfo=UTC)
SEASON = 2026
# The scratch database has no stat weeks, so the current week falls back to 1, as it does in
# production before the stats pipeline has written one.
WEEK = 1


def _specs(fetcher: Fetcher) -> list[RecordSpec]:
    client = _live_client(fetcher)
    headers = {"x-rapidapi-key": client.api_key, "x-rapidapi-host": client.host}
    context = CaptureContext(SEASON, WEEK, js_iso(FIRED_AT)[:10].replace("-", ""), ())
    return [
        RecordSpec(
            url=client.url(request.path, request.query or None), file=f"{feed.source}.json.gz", request_headers=headers
        )
        for feed in harvest_feeds()
        for request in feed.requests(context)
    ]


HARVEST = Recording(
    fixture_set="tank01-harvest-2026-10-12",
    specs=_specs,
    note="The capture harvest's five Tank01 feeds (injuries by date, news, depth charts, inactives for week 1, "
    "the betting odds for 2026-10-12), recorded from the live API.",
)


def _harvest(conn: Connection, ctx: RunContext) -> None:
    client = Tank01Client(ctx.fetcher, REPLAY_KEY)
    run_capture_harvest(conn, client, FIRED_AT, SEASON)
    run_capture_harvest(conn, client, FIRED_AT + timedelta(hours=1), SEASON)


CASES: tuple[Case, ...] = (
    Case(
        name="tank01-capture-harvest",
        summary="the capture-harvest job's five feeds into capture_snapshots, twice (captured, then unchanged)",
        fixture_sets=("tank01-harvest-2026-10-12",),
        tables=(CAPTURE_SNAPSHOTS,),
        run_python=_harvest,
        now=FIRED_AT,
        recordings=(HARVEST,),
    ),
)
