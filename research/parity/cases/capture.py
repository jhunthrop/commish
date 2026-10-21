"""The capture-harvest case: the job's five feeds and its day read of the player list, fired twice an
hour apart on the same recorded responses, so the second fire exercises the unchanged-digest path on both
sides. The player list's read writes each listed player's club onto `provider_players` (Lane 122): both
sides seed the same stale roster first, and the earlier recording moves one club between passes."""

import json
from datetime import UTC, datetime, timedelta
from typing import Final

from sqlalchemy import Connection
from sqlalchemy.dialects.postgresql import insert

from research.db import schema
from research.parity.case import Case, Recording, RunContext
from research.parity.cases.tables import CAPTURE_SNAPSHOTS, PROVIDER_PLAYERS
from research.parity.cases.tank01 import REPLAY_KEY, _live_client
from research.parity.record import RecordSpec
from research.parity.replay import FIXTURES_ROOT
from research.pipeline.budget import UnmeteredBudget
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_iso
from research.pipeline.nflverse.team_codes import NFL_TEAM_ABBREVIATIONS
from research.pipeline.tank01.capture import (
    CAPTURE_FEEDS,
    PLAYER_LIST_FEED,
    CaptureContext,
    CapturePass,
    capture_once,
    harvest_feeds,
    run_capture_harvest,
)
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


def _all_specs(fetcher: Fetcher) -> list[RecordSpec]:
    client = _live_client(fetcher)
    headers = {"x-rapidapi-key": client.api_key, "x-rapidapi-host": client.host}
    context = CaptureContext(SEASON, WEEK, js_iso(FIRED_AT)[:10].replace("-", ""), NFL_TEAM_ABBREVIATIONS)
    specs = []
    for feed in CAPTURE_FEEDS:
        for index, request in enumerate(feed.requests(context)):
            suffix = f"_{request.query['teamAbv']}" if "teamAbv" in request.query else ""
            specs.append(
                RecordSpec(
                    url=client.url(request.path, request.query or None),
                    file=f"{feed.source}{suffix or ('' if index == 0 else f'_{index}')}.json.gz",
                    request_headers=headers,
                )
            )
    return specs


ALL_FEEDS = Recording(
    fixture_set="tank01-capture-all-2026-10-12",
    specs=_all_specs,
    note="Every Tank01 capture feed for a Monday (the game-day feeds due), recorded from the live API: the 32 "
    "team rosters, depth charts, changelog, news, the day's betting odds and DFS salaries, ADP, week-1 "
    "projections, injuries by date, week-1 inactives and the player list.",
)

HARVEST = Recording(
    fixture_set="tank01-harvest-2026-10-12",
    specs=_specs,
    note="The capture harvest's five Tank01 feeds (injuries by date, news, depth charts, inactives for week 1, "
    "the betting odds for 2026-10-12), recorded from the live API.",
)


# The later pass fires two hours on, the same Monday (the date-keyed feeds ask for the recorded day), so its
# captures are stamped after the earlier pass's and the list's read is a new snapshot, not a second one at
# the same instant.
LATER_FIRED_AT: Final = FIRED_AT + timedelta(hours=2)
# The earlier player list (McCarthy still MIN's) and the stale roster both sides seed before every pass.
EARLIER_PLAYER_LIST: Final = "tank01-player-list-earlier"
SEED_PLAYERS: Final = FIXTURES_ROOT / EARLIER_PLAYER_LIST / "seed_players.json"
# The 2026-10-12 player list comes from the full capture's recording; the harvest's own recordings win
# every other request the two share.
HARVEST_SETS: Final = ("tank01-capture-all-2026-10-12", "tank01-harvest-2026-10-12")


def _seed_players(conn: Connection) -> None:
    """The stale roster, inserted where absent, so a later pass lands on the earlier pass's clubs."""
    rows = json.loads(SEED_PLAYERS.read_text())
    conn.execute(insert(schema.PROVIDER_PLAYERS).values(rows).on_conflict_do_nothing(index_elements=["id"]))


def _harvest(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    """`harvestCaptures`, the in-season capture task, fired twice an hour apart, each fire followed by the
    player list's read and its clubs (`capture_return_dates` past its once-a-day gate)."""
    client = Tank01Client(ctx.fetcher, REPLAY_KEY)
    _seed_players(conn)
    for fired_at in (ctx.now, ctx.now + timedelta(hours=1)):
        run_capture_harvest(conn, client, fired_at, SEASON)
        capture = CapturePass(fired_at, SEASON, WEEK, feeds=(PLAYER_LIST_FEED,))
        capture_once(conn, client, capture, UnmeteredBudget())
    return ()


def _capture_all(conn: Connection, ctx: RunContext) -> tuple[int, ...]:
    capture = CapturePass(FIRED_AT, SEASON, WEEK)
    capture_once(conn, Tank01Client(ctx.fetcher, REPLAY_KEY), capture, UnmeteredBudget())
    return ()


CASES: tuple[Case, ...] = (
    # B73 (Lane 107) departs from the oracle where this recording cannot show it. For a week not published
    # yet the provider answers in one of two ways. An empty body or an empty player map: the TypeScript full
    # list stores it as a snapshot, the Python one screens it out, stores none and reports the feed
    # unpublished. A 404 or an error envelope: the TypeScript client throws (Tank01Error "upstream",
    # research-ts/src/stats/tank01/client.ts), so its captureOnce reports the feed failed with that reason,
    # stores nothing and leaves the feed unmarked so the next tick asks again; the Python one reports it
    # unpublished and stores nothing. So on a 404 week `capture_snapshots` matches and only the feed's outcome
    # differs (failed against unpublished); on an empty week the table differs too (Lane 118, B94). The
    # recorded week-1 projections are published, so both store them; a mismatch on a recording of an
    # unpublished week is that intended departure, not a bug.
    Case(
        name="tank01-capture-all",
        summary="captureOnce with every feed (the operator's stats:capture pass) into capture_snapshots",
        fixture_sets=("tank01-capture-all-2026-10-12",),
        tables=(CAPTURE_SNAPSHOTS,),
        run_python=_capture_all,
        now=FIRED_AT,
        recordings=(ALL_FEEDS,),
    ),
    Case(
        name="tank01-capture-harvest",
        summary="the capture-harvest job's five feeds and the player list into capture_snapshots, twice (captured, "
        "then unchanged), and the list's clubs onto a seeded provider_players, the listed free agent's cleared "
        "to NULL (Lane 123); the later pass lands the 2026-10-12 list on an earlier one that had McCarthy at "
        "MIN, whose club it must move",
        fixture_sets=HARVEST_SETS,
        tables=(CAPTURE_SNAPSHOTS, PROVIDER_PLAYERS),
        run_python=_harvest,
        now=FIRED_AT,
        recordings=(HARVEST,),
        prior_fixture_sets=(*HARVEST_SETS, EARLIER_PLAYER_LIST),
        later_now=LATER_FIRED_AT,
    ),
)
