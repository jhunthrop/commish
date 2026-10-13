"""THE HISTORICAL PROPS BACKFILL (`scripts/odds-props-backfill.ts`, `odds/{historical,backfill-plan}.ts`).

For each requested season, each week's first kickoff (from the stored schedule) less eight hours
is the instant the historical archive is read at: the events page, then the five prop markets of
every event kicking off within eight days of that kickoff that is not already archived. Credits
are read off each response's headers, and the run stops BEFORE a request once this run has spent
its budget. NOT ATOMIC, AS THE TYPESCRIPT IS NOT: `checkpoint` is called after each event, so a
stopped run keeps every event it wrote and a re-run skips them.
"""

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import Final

from sqlalchemy import Connection, select, text

from research.db.schema import PLAYER_PROP_OBSERVATIONS, TEAM_WEEK_OBSERVATIONS
from research.errors import SchemaDriftError
from research.pipeline.checkpoint import Checkpoint, no_checkpoint
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_date_parse, js_is_finite, js_iso, js_number
from research.pipeline.odds.props import (
    ODDS_PARAMS,
    SPORT_KEY,
    CreditStatus,
    OddsEvent,
    get_json,
    odds_url,
    parse_event_odds_response,
    parse_odds_event,
    record_prop_observations,
)

SNAPSHOT_OFFSET_HOURS: Final = 8
WEEK_WINDOW_DAYS: Final = 8


def kickoff_instants_by_week(conn: Connection, season: int) -> dict[int, datetime]:
    """`kickoffInstantsByWeek`: each week's earliest stored kickoff instant."""
    rows = conn.execute(
        text(
            f"select week, min(as_of) from {TEAM_WEEK_OBSERVATIONS.fullname} where season = :season "
            "and source = 'nflverse_kickoff' and metric = 'kickoff_instant' group by week"
        ),
        {"season": season},
    )
    return {int(week): earliest for week, earliest in rows if earliest is not None}


def to_historical_date_param(instant: datetime) -> str:
    """`toHistoricalDateParam`: ISO without milliseconds."""
    return js_iso(instant)[:-5] + "Z"


@dataclass(frozen=True)
class CreditTracker:
    """What this run has spent, from the first response's `x-requests-used` onward."""

    used_this_run: float = 0.0
    last_remaining: str = "unknown"
    used_at_start: float | None = None

    def tracked(self, credits: CreditStatus) -> "CreditTracker":
        used = js_number(credits.used) if credits.used != "unknown" else float("nan")
        if not js_is_finite(used):
            return replace(self, last_remaining=credits.remaining)
        start = used if self.used_at_start is None else self.used_at_start
        return CreditTracker(used - start, credits.remaining, start)


def _timestamp(value: object, path: str) -> datetime:
    parsed = js_date_parse(value) if isinstance(value, str) else None
    if parsed is None:
        raise SchemaDriftError(f'{path} is missing or unparseable ("{value}").')
    return parsed


def _week_events(
    fetcher: Fetcher, api_key: str, snapshot_at: str, first_kickoff: datetime
) -> tuple[list[OddsEvent], CreditStatus]:
    url = odds_url(f"/historical/sports/{SPORT_KEY}/events", api_key, {"date": snapshot_at})
    payload, credits = get_json(fetcher, url, "/historical/events")
    if not isinstance(payload, dict):
        raise SchemaDriftError("historical /events response was not an object.")
    _timestamp(payload.get("timestamp"), "historical /events response.timestamp")
    data = payload.get("data")
    if not isinstance(data, list):
        raise SchemaDriftError("historical /events response.data was not an array.")
    events = [parse_odds_event(raw, f"historical /events response.data[{i}]") for i, raw in enumerate(data)]
    window_end = first_kickoff + timedelta(days=WEEK_WINDOW_DAYS)
    return [e for e in events if first_kickoff <= e.commence_time < window_end], credits


def _archive_event(
    conn: Connection, fetcher: Fetcher, api_key: str, event: OddsEvent, snapshot_at: str
) -> CreditStatus:
    path = f"/historical/sports/{SPORT_KEY}/events/{event.id}/odds"
    url = odds_url(path, api_key, {"date": snapshot_at, **dict(ODDS_PARAMS)})
    payload, credits = get_json(fetcher, url, f"/historical/events/{event.id}/odds")
    if not isinstance(payload, dict):
        raise SchemaDriftError("historical event-odds response was not an object.")
    timestamp = _timestamp(payload.get("timestamp"), "historical event-odds response.timestamp")
    record_prop_observations(conn, parse_event_odds_response(payload.get("data"), timestamp).observations)
    return credits


@dataclass(frozen=True)
class BackfillRequest:
    api_key: str
    seasons: tuple[int, ...]
    budget: float


def backfill_props(
    conn: Connection, fetcher: Fetcher, request: BackfillRequest, checkpoint: Checkpoint = no_checkpoint
) -> bool:
    """`odds-props-backfill.ts`'s run: True when the budget stopped it."""
    archived = set(conn.execute(select(PLAYER_PROP_OBSERVATIONS.c.event_id)).scalars())
    tracker = CreditTracker()
    for season in request.seasons:
        kickoffs = kickoff_instants_by_week(conn, season)
        for week in sorted(kickoffs):
            if tracker.used_this_run >= request.budget:
                return True
            snapshot_at = to_historical_date_param(kickoffs[week] - timedelta(hours=SNAPSHOT_OFFSET_HOURS))
            events, credits = _week_events(fetcher, request.api_key, snapshot_at, kickoffs[week])
            tracker = tracker.tracked(credits)
            for event in (e for e in events if e.id not in archived):
                if tracker.used_this_run >= request.budget:
                    return True
                tracker = tracker.tracked(_archive_event(conn, fetcher, request.api_key, event, snapshot_at))
                archived.add(event.id)
                checkpoint()
    return False
