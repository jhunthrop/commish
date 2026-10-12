"""THE PROPS INGESTS: the live snapshot, the name resolution, and the historical backfill
(`src/projections/odds/{snapshot,player-map,backfill-plan}.ts`, `scripts/odds-props-backfill.ts`,
the props-preseason-snapshot job).

THE SNAPSHOT takes every event kicking off in the next fourteen days, earliest first, at most
twenty, and stores each one's two-sided lines under one fetched-at instant. THE RESOLUTION maps
every observed prop name to a universe player active that season, exact name first, a unique
first-initial-and-surname second, and never guesses between two. THE BACKFILL walks a season's
weeks, reading the historical archive eight hours before each week's first kickoff, skipping any
event already archived, and stops before it spends past its credit budget.
"""

import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import Connection, and_, select, text

from research.db.schema import NFL_PLAYERS, PLAYER_PROP_OBSERVATIONS, PROPS_PLAYER_MAP
from research.pipeline.crosswalk import comparable_name
from research.pipeline.http import Fetcher
from research.pipeline.jscompat import js_date_parse, js_is_finite, js_iso, js_number
from research.pipeline.observations import insert_ignoring_conflicts
from research.pipeline.odds.props import (
    PROP_MARKETS,
    SPORT_KEY,
    CreditStatus,
    OddsEvent,
    get_json,
    odds_url,
    parse_event_odds_response,
    parse_odds_event,
    record_prop_observations,
)

LOG = logging.getLogger(__name__)
_WINDOW_DAYS = 14
_MAX_EVENTS_PER_RUN = 20
_SNAPSHOT_OFFSET_HOURS = 8
_WEEK_WINDOW_DAYS = 8
_ODDS_PARAMS = {"regions": "us", "markets": ",".join(PROP_MARKETS), "oddsFormat": "american"}


# --- the live snapshot ----------------------------------------------------------------------------


@dataclass(frozen=True)
class SnapshotSummary:
    total_events: int
    selected_events: int
    total_written: int
    total_skipped: int
    credits: CreditStatus


def select_upcoming_events(
    fetcher: Fetcher, api_key: str, now: datetime
) -> tuple[list[OddsEvent], list[OddsEvent], CreditStatus]:
    payload, credits = get_json(fetcher, odds_url(f"/sports/{SPORT_KEY}/events", api_key), "/events")
    if not isinstance(payload, list):
        raise ValueError("odds snapshot: /events response was not an array.")
    events = [parse_odds_event(raw, f"odds snapshot: /events[{i}]") for i, raw in enumerate(payload)]
    window_end = now + timedelta(days=_WINDOW_DAYS)
    upcoming = sorted((e for e in events if now <= e.commence_time <= window_end), key=lambda e: e.commence_time)
    return events, upcoming[:_MAX_EVENTS_PER_RUN], credits


def run_odds_snapshot(conn: Connection, fetcher: Fetcher, api_key: str, now: datetime) -> SnapshotSummary:
    """`runOddsSnapshot`: one fetched-at instant for every event of the run."""
    events, selected, credits = select_upcoming_events(fetcher, api_key, now)
    written = 0
    skipped = 0
    for event in selected:
        path = f"/sports/{SPORT_KEY}/events/{event.id}/odds"
        payload, credits = get_json(fetcher, odds_url(path, api_key, _ODDS_PARAMS), f"/events/{event.id}/odds")
        parsed = parse_event_odds_response(payload, now)
        written += record_prop_observations(conn, parsed.observations)
        skipped += len(parsed.skipped)
    return SnapshotSummary(len(events), len(selected), written, skipped, credits)


# --- resolving prop names -------------------------------------------------------------------------


@dataclass(frozen=True)
class PropName:
    prop_name: str
    season: int


@dataclass(frozen=True)
class PlayerMapRow:
    prop_name: str
    season: int
    player_id: str
    method: str


def _loose_key(name: str) -> str | None:
    parts = comparable_name(name).split(" ")
    if len(parts) < 2:
        return None
    return f"{parts[0][:1]}|{parts[-1]}"


def season_of_kickoff(commence_time: datetime) -> int:
    """January and February belong to the season that started the previous autumn."""
    return commence_time.year - 1 if commence_time.month <= 2 else commence_time.year


def resolve_prop_names(
    prop_names: Sequence[PropName], candidates_by_season: dict[int, list[tuple[str, str]]]
) -> tuple[list[PlayerMapRow], list[tuple[PropName, str]]]:
    matched: list[PlayerMapRow] = []
    unmatched: list[tuple[PropName, str]] = []
    indexes: dict[int, tuple[dict[str, list[str]], dict[str, list[str]]]] = {}
    for entry in prop_names:
        if entry.season not in indexes:
            exact_index: dict[str, list[str]] = {}
            loose_index: dict[str, list[str]] = {}
            for player_id, name in candidates_by_season.get(entry.season, []):
                exact_index.setdefault(comparable_name(name), []).append(player_id)
                loose = _loose_key(name)
                if loose is not None:
                    loose_index.setdefault(loose, []).append(player_id)
            indexes[entry.season] = (exact_index, loose_index)
        exact_index, loose_index = indexes[entry.season]
        exact = exact_index.get(comparable_name(entry.prop_name), [])
        if len(exact) == 1:
            matched.append(PlayerMapRow(entry.prop_name, entry.season, exact[0], "exact"))
            continue
        if len(exact) > 1:
            unmatched.append((entry, "ambiguous"))
            continue
        loose_key = _loose_key(entry.prop_name)
        loose_ids = [] if loose_key is None else loose_index.get(loose_key, [])
        if len(loose_ids) == 1:
            matched.append(PlayerMapRow(entry.prop_name, entry.season, loose_ids[0], "loose"))
            continue
        unmatched.append((entry, "ambiguous" if len(loose_ids) > 1 else "not_found"))
    return matched, unmatched


def resolve_all_prop_names(conn: Connection) -> int:
    """`resolveAllPropNames`: every observed (name, season) archive-wide, idempotent."""
    seen: dict[str, PropName] = {}
    rows = conn.execute(select(PLAYER_PROP_OBSERVATIONS.c.player_name, PLAYER_PROP_OBSERVATIONS.c.commence_time))
    for name, commence in rows:
        season = season_of_kickoff(commence)
        seen.setdefault(f"{name}|{season}", PropName(name, season))
    observed = list(seen.values())
    candidates: dict[int, list[tuple[str, str]]] = {}
    for season in sorted({p.season for p in observed}):
        query = select(NFL_PLAYERS.c.id, NFL_PLAYERS.c.name).where(
            and_(NFL_PLAYERS.c.rookie_season <= season, NFL_PLAYERS.c.last_season >= season)
        )
        candidates[season] = [(r[0], r[1]) for r in conn.execute(query)]
    matched, _ = resolve_prop_names(observed, candidates)
    if not matched:
        return 0
    return insert_ignoring_conflicts(
        conn,
        PROPS_PLAYER_MAP,
        [{"prop_name": m.prop_name, "season": m.season, "player_id": m.player_id, "method": m.method} for m in matched],
    )


# --- the preseason job ----------------------------------------------------------------------------


def run_props_preseason_snapshot(
    conn: Connection, fetcher: Fetcher, api_key: str, fired_at: datetime, season: int, first_kickoff: datetime | None
) -> str:
    """The props-preseason-snapshot job: capture then resolve, both strictly before the first kickoff."""
    if first_kickoff is None:
        return f"{season} has no ingested schedule yet; skipping (no network call made)"
    if fired_at >= first_kickoff:
        return (
            f"{season} kicked off at {js_iso(first_kickoff)}; the pre-kickoff window is closed (no network call made)"
        )
    summary = run_odds_snapshot(conn, fetcher, api_key, fired_at)
    resolve_all_prop_names(conn)
    return f"fetched {summary.total_events} event(s), wrote {summary.total_written}"


# --- the historical backfill ----------------------------------------------------------------------


def kickoff_instants_by_week(conn: Connection, season: int) -> dict[int, datetime]:
    rows = conn.execute(
        text(
            "select week, min(as_of) from team_week_observations where season = :season "
            "and source = 'nflverse_kickoff' and metric = 'kickoff_instant' group by week"
        ),
        {"season": season},
    )
    return {int(week): earliest for week, earliest in rows if earliest is not None}


def to_historical_date_param(instant: datetime) -> str:
    return js_iso(instant)[:-5] + "Z"


@dataclass
class CreditTracker:
    used_this_run: float = 0.0
    last_remaining: str = "unknown"
    used_at_start: float | None = field(default=None)

    def track(self, credits: CreditStatus) -> None:
        self.last_remaining = credits.remaining
        used = js_number(credits.used) if credits.used != "unknown" else float("nan")
        if not js_is_finite(used):
            return
        if self.used_at_start is None:
            self.used_at_start = used
        self.used_this_run = used - self.used_at_start


def backfill_props(
    conn: Connection, fetcher: Fetcher, api_key: str, seasons: Sequence[int], budget: float,
    on_week: Callable[[str], None] = LOG.info,
) -> bool:  # fmt: skip
    """`odds-props-backfill.ts`: returns True when the budget stopped the run."""
    archived = set(conn.execute(select(PLAYER_PROP_OBSERVATIONS.c.event_id)).scalars())
    tracker = CreditTracker()
    for season in seasons:
        kickoffs = kickoff_instants_by_week(conn, season)
        if not kickoffs:
            on_week(f"season {season}: no kickoff instants in the store. Skipped.")
            continue
        for week in sorted(kickoffs):
            if tracker.used_this_run >= budget:
                return True
            first_kickoff = kickoffs[week]
            snapshot_at = to_historical_date_param(first_kickoff - timedelta(hours=_SNAPSHOT_OFFSET_HOURS))
            events_payload, credits = get_json(
                fetcher,
                odds_url(f"/historical/sports/{SPORT_KEY}/events", api_key, {"date": snapshot_at}),
                "/historical/events",
            )
            tracker.track(credits)
            page = events_payload if isinstance(events_payload, dict) else None
            if page is None:
                raise ValueError("historical /events response was not an object.")
            _require_timestamp(page.get("timestamp"), "historical /events response.timestamp")
            if not isinstance(page.get("data"), list):
                raise ValueError("historical /events response.data was not an array.")
            events = [
                parse_odds_event(raw, f"historical /events response.data[{i}]") for i, raw in enumerate(page["data"])
            ]
            window_end = first_kickoff + timedelta(days=_WEEK_WINDOW_DAYS)
            in_week = [e for e in events if first_kickoff <= e.commence_time < window_end]
            for event in (e for e in in_week if e.id not in archived):
                if tracker.used_this_run >= budget:
                    return True
                odds_payload, credits = get_json(
                    fetcher,
                    odds_url(
                        f"/historical/sports/{SPORT_KEY}/events/{event.id}/odds",
                        api_key,
                        {"date": snapshot_at, **_ODDS_PARAMS},
                    ),
                    f"/historical/events/{event.id}/odds",
                )
                tracker.track(credits)
                if not isinstance(odds_payload, dict):
                    raise ValueError("historical event-odds response was not an object.")
                timestamp = _require_timestamp(
                    odds_payload.get("timestamp"), "historical event-odds response.timestamp"
                )
                parsed = parse_event_odds_response(odds_payload.get("data"), timestamp)
                record_prop_observations(conn, parsed.observations)
                archived.add(event.id)
    return False


def _require_timestamp(value: object, path: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{path} is missing.")
    parsed = js_date_parse(value)
    if parsed is None:
        raise ValueError(f'{path} is unparseable ("{value}").')
    return parsed
